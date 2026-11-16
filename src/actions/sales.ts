"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formValues, type ActionState } from "@/lib/action-state";
import { cancelSaleSchema, customerSchema, paymentSchema, saleSchema } from "@/lib/validation/sales";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/request";
import { requireMember, requireOwner } from "@/server/auth/context";
import { createCustomer, CustomerError, updateCustomer } from "@/server/services/customers";
import { StockError, type Actor } from "@/server/services/inventory";
import { addPayment, cancelSale, createSale, SaleError } from "@/server/services/sales";

const idSchema = z.uuid();

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function member(): Promise<{ actor: Actor; isOwner: boolean }> {
  const context = await requireMember();
  return {
    actor: { businessId: context.business.id, userId: context.user.id },
    isOwner: context.role === "owner",
  };
}

function failure(error: unknown, formData?: FormData): ActionState {
  const values = formData ? formValues(formData) : undefined;
  if (error instanceof CustomerError && error.code === "PHONE_TAKEN") {
    return { fieldErrors: { phone: [error.message] }, values };
  }
  if (error instanceof SaleError || error instanceof StockError || error instanceof CustomerError) {
    return { error: error.message, values };
  }
  console.error("Error de ventas", error instanceof Error ? error.message : "desconocido");
  return { error: "No pudimos guardar el cambio. Inténtalo de nuevo.", values };
}

function refreshSales(saleId?: string, customerId?: string | null) {
  revalidatePath("/");
  revalidatePath("/ventas");
  revalidatePath("/inventario", "layout");
  revalidatePath("/clientes", "layout");
  if (saleId) revalidatePath(`/ventas/${saleId}`);
  if (customerId) revalidatePath(`/clientes/${customerId}`);
}

/* -------------------------------------------------------------------------- */
/* Clientes                                                                    */
/* -------------------------------------------------------------------------- */

function customerInput(formData: FormData) {
  return customerSchema.safeParse({
    name: text(formData, "name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    notes: text(formData, "notes"),
  });
}

export async function createCustomerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor } = await member();
  const parsed = customerInput(formData);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: formValues(formData) };
  }

  let id: string;
  try {
    id = (await createCustomer(actor, parsed.data)).id;
  } catch (error) {
    return failure(error, formData);
  }

  revalidatePath("/clientes");
  const returnTo = text(formData, "returnTo");
  redirect(returnTo === "venta" ? `/ventas/nueva?cliente=${id}` : `/clientes/${id}`);
}

export async function updateCustomerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor } = await member();
  const customerId = idSchema.safeParse(text(formData, "customerId"));
  if (!customerId.success) return { error: "Cliente inválido." };

  const parsed = customerInput(formData);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: formValues(formData) };
  }

  try {
    await updateCustomer(actor, customerId.data, {
      ...parsed.data,
      isActive: formData.get("isActive") === "on",
    });
  } catch (error) {
    return failure(error, formData);
  }

  revalidatePath("/clientes", "layout");
  return { success: "Cliente actualizado." };
}

/* -------------------------------------------------------------------------- */
/* Ventas                                                                      */
/* -------------------------------------------------------------------------- */

export async function createSaleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor } = await member();

  let payload: unknown;
  try {
    payload = JSON.parse(text(formData, "payload"));
  } catch {
    return { error: "No pudimos leer la venta. Recarga la página e inténtalo de nuevo." };
  }

  const parsed = saleSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Revisa los datos de la venta." };
  }

  const input = parsed.data;
  let saleId: string;
  try {
    const sale = await createSale(actor, {
      customerId: input.customerId,
      items: input.items.map((item) => ({
        variantId: item.variantId,
        qtyMilli: item.qty,
        unitPriceCents: item.price,
      })),
      discountCents: input.discount,
      payment: input.paid > 0 ? { amountCents: input.paid, method: input.method } : null,
      note: input.note,
    });
    saleId = sale.id;
    // Se registran las ventas con descuento o con precios distintos al de lista.
    if (sale.discountCents > 0 || sale.priceOverrides > 0) {
      await recordAudit({
        businessId: actor.businessId,
        userId: actor.userId,
        action: "sale.created",
        entityType: "sale",
        entityId: sale.id,
        details: {
          number: sale.number,
          totalCents: sale.totalCents,
          discountCents: sale.discountCents,
          priceOverrides: sale.priceOverrides,
        },
        ipAddress: await clientIp(),
      });
    }
  } catch (error) {
    return failure(error);
  }

  refreshSales(saleId, input.customerId);
  redirect(`/ventas/${saleId}`);
}

export async function addPaymentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor } = await member();
  const saleId = idSchema.safeParse(text(formData, "saleId"));
  if (!saleId.success) return { error: "Venta inválida." };

  const parsed = paymentSchema.safeParse({
    amount: text(formData, "amount"),
    method: text(formData, "method"),
    note: text(formData, "note"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: formValues(formData) };
  }

  try {
    const payment = await addPayment(actor, {
      saleId: saleId.data,
      amountCents: parsed.data.amount,
      method: parsed.data.method,
      note: parsed.data.note,
    });
    await recordAudit({
      businessId: actor.businessId,
      userId: actor.userId,
      action: "payment.added",
      entityType: "sale",
      entityId: saleId.data,
      details: { paymentId: payment.id, amountCents: payment.amountCents, method: payment.method },
      ipAddress: await clientIp(),
    });
  } catch (error) {
    return failure(error, formData);
  }

  refreshSales(saleId.data, text(formData, "customerId") || null);
  return { success: "Abono registrado." };
}

/** Solo el dueño anula ventas. */
export async function cancelSaleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireOwner();
  const actor = { businessId: context.business.id, userId: context.user.id };
  const saleId = idSchema.safeParse(text(formData, "saleId"));
  if (!saleId.success) return { error: "Venta inválida." };

  const parsed = cancelSaleSchema.safeParse({ reason: text(formData, "reason") });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: formValues(formData) };
  }

  let customerId: string | null;
  try {
    const result = await cancelSale(actor, { saleId: saleId.data, reason: parsed.data.reason });
    customerId = result.sale.customerId;
    await recordAudit({
      businessId: actor.businessId,
      userId: actor.userId,
      action: "sale.cancelled",
      entityType: "sale",
      entityId: saleId.data,
      details: {
        number: result.sale.number,
        totalCents: result.sale.totalCents,
        refundCents: result.refundCents,
        reason: parsed.data.reason,
      },
      ipAddress: await clientIp(),
    });
  } catch (error) {
    return failure(error, formData);
  }

  refreshSales(saleId.data, customerId);
  return { success: "Venta anulada. El stock volvió al inventario." };
}
