"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formValues, type ActionState } from "@/lib/action-state";
import { formatDateTime } from "@/lib/dates";
import { balanceReminderText, saleReceiptText } from "@/lib/whatsapp-link";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/request";
import { requireMember, requireOwner } from "@/server/auth/context";
import { SLUG_PATTERN } from "@/server/services/catalog";
import { getCustomerDetail } from "@/server/services/customers";
import { getSaleDetail } from "@/server/services/sales";
import {
  regenerateVerifyToken,
  sendWhatsappText,
  testWhatsappConnection,
  updateCatalogSettings,
  updateWhatsappSettings,
  WhatsappError,
} from "@/server/services/whatsapp";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function failure(error: unknown, formData?: FormData): ActionState {
  const values = formData ? formValues(formData) : undefined;
  if (error instanceof WhatsappError) return { error: error.message, values };
  console.error("Error de WhatsApp", error instanceof Error ? error.message : "desconocido");
  return { error: "No pudimos completar la acción. Inténtalo de nuevo.", values };
}

const settingsSchema = z.object({
  mode: z.enum(["basic", "cloud"]),
  phoneNumberId: z
    .string()
    .regex(/^\d{5,30}$/, "El ID del número son solo dígitos (lo ves en Meta → WhatsApp → API Setup)")
    .or(z.literal(""))
    .transform((value) => value || null),
  wabaId: z
    .string()
    .regex(/^\d{5,30}$/, "El ID de la cuenta son solo dígitos")
    .or(z.literal(""))
    .transform((value) => value || null),
  messageCap: z.coerce.number().int("Debe ser un número entero").min(0, "Mínimo 0").max(100_000, "Máximo 100.000"),
});

export async function updateWhatsappSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireOwner();
  const parsed = settingsSchema.safeParse({
    mode: text(formData, "mode"),
    phoneNumberId: text(formData, "phoneNumberId"),
    wabaId: text(formData, "wabaId"),
    messageCap: text(formData, "messageCap"),
  });
  if (!parsed.success) {
    // Los secretos nunca vuelven al formulario.
    const values = formValues(formData);
    delete values.accessToken;
    delete values.appSecret;
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const accessToken = text(formData, "accessToken");
  const appSecret = text(formData, "appSecret");
  const clear = formData.get("clearSecrets") === "on";

  try {
    await updateWhatsappSettings(
      { businessId: context.business.id, userId: context.user.id },
      {
        ...parsed.data,
        accessToken: clear ? null : accessToken || undefined,
        appSecret: clear ? null : appSecret || undefined,
        messagesEnabled: formData.get("messagesEnabled") === "on",
      },
    );
  } catch (error) {
    const result = failure(error, formData);
    delete result.values?.accessToken;
    delete result.values?.appSecret;
    return result;
  }

  await recordAudit({
    businessId: context.business.id,
    userId: context.user.id,
    action: "whatsapp.settings_updated",
    entityType: "whatsapp",
    // Nunca se registran tokens ni secretos: solo si cambiaron.
    details: {
      mode: parsed.data.mode,
      phoneNumberId: parsed.data.phoneNumberId,
      messageCap: parsed.data.messageCap,
      accessTokenChanged: clear || Boolean(accessToken),
      appSecretChanged: clear || Boolean(appSecret),
    },
    ipAddress: await clientIp(),
  });

  revalidatePath("/ajustes");
  return { success: "Configuración de WhatsApp guardada." };
}

export async function regenerateVerifyTokenAction(): Promise<void> {
  const context = await requireOwner();
  await regenerateVerifyToken({ businessId: context.business.id, userId: context.user.id });
  revalidatePath("/ajustes");
}

export async function testWhatsappConnectionAction(): Promise<ActionState> {
  const context = await requireOwner();
  try {
    const result = await testWhatsappConnection(context.business.id);
    return { success: `Conexión correcta: ${result.name || "número"} ${result.phone}`.trim() };
  } catch (error) {
    return failure(error);
  }
}

export async function updateCatalogAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireOwner();
  const slug = text(formData, "slug").toLowerCase();
  if (slug && !SLUG_PATTERN.test(slug)) {
    return {
      fieldErrors: { slug: ["Usa de 3 a 40 letras minúsculas, números o guiones, sin espacios"] },
      values: formValues(formData),
    };
  }

  try {
    await updateCatalogSettings(
      { businessId: context.business.id, userId: context.user.id },
      { slug: slug || null, enabled: formData.get("catalogEnabled") === "on" },
    );
  } catch (error) {
    return failure(error, formData);
  }

  await recordAudit({
    businessId: context.business.id,
    userId: context.user.id,
    action: "catalog.updated",
    entityType: "catalog",
    details: { slug: slug || null, enabled: formData.get("catalogEnabled") === "on" },
    ipAddress: await clientIp(),
  });

  revalidatePath("/ajustes");
  return { success: "Catálogo actualizado." };
}

/* -------------------------------------------------------------------------- */
/* Envíos por Cloud API                                                        */
/* -------------------------------------------------------------------------- */

const idSchema = z.uuid();

export async function sendSaleReceiptAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireMember();
  const saleId = idSchema.safeParse(text(formData, "saleId"));
  if (!saleId.success) return { error: "Venta inválida." };

  const detail = await getSaleDetail(context.business.id, saleId.data);
  if (!detail) return { error: "No encontramos esa venta." };
  if (detail.sale.status === "cancelled") return { error: "La venta está anulada: no se envía recibo." };

  const body = saleReceiptText({
    businessName: context.business.name,
    currency: context.business.currency,
    number: detail.sale.number,
    customerName: detail.customerName,
    items: detail.items.map((item) => ({
      description: item.description,
      qtyMilli: item.qtyMilli,
      unit: item.unit,
      lineTotalCents: item.lineTotalCents,
    })),
    discountCents: detail.sale.discountCents,
    totalCents: detail.sale.totalCents,
    paidCents: detail.sale.paidCents,
    dateLabel: formatDateTime(detail.sale.createdAt, context.business.timezone),
  });

  try {
    await sendWhatsappText(
      { businessId: context.business.id, userId: context.user.id },
      { phone: detail.customerPhone, body, kind: "receipt" },
    );
  } catch (error) {
    return failure(error);
  }
  return { success: "Recibo enviado por WhatsApp." };
}

export async function sendBalanceReminderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireMember();
  const customerId = idSchema.safeParse(text(formData, "customerId"));
  if (!customerId.success) return { error: "Cliente inválido." };

  const detail = await getCustomerDetail(context.business.id, customerId.data);
  if (!detail) return { error: "No encontramos ese cliente." };
  if (detail.balanceCents <= 0) return { error: "Este cliente no tiene saldo pendiente." };

  try {
    await sendWhatsappText(
      { businessId: context.business.id, userId: context.user.id },
      {
        phone: detail.customer.phone,
        body: balanceReminderText({
          businessName: context.business.name,
          currency: context.business.currency,
          customerName: detail.customer.name,
          balanceCents: detail.balanceCents,
        }),
        kind: "reminder",
      },
    );
  } catch (error) {
    return failure(error);
  }
  return { success: "Recordatorio enviado por WhatsApp." };
}
