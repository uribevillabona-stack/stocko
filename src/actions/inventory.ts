"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formValues, type ActionState } from "@/lib/action-state";
import {
  movementSchema,
  newProductSchema,
  newVariantSchema,
  productSchema,
  updateVariantSchema,
} from "@/lib/validation/inventory";
import { ImageError, MAX_UPLOAD_BYTES, processProductPhoto } from "@/lib/images";
import { newPhotoKey, photosEnabled, putPhoto, removePhoto } from "@/lib/storage";
import { recordAudit, type AuditAction } from "@/lib/audit";
import { clientIp } from "@/lib/request";
import { requireMember } from "@/server/auth/context";
import {
  addVariant,
  closeReservation,
  createProduct,
  recordAdjustment,
  recordEntry,
  recordExit,
  reserveStock,
  setProductPhoto,
  StockError,
  updateProduct,
  updateVariant,
  type Actor,
} from "@/server/services/inventory";

const idSchema = z.uuid();

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function actor(): Promise<{ actor: Actor; isOwner: boolean }> {
  const context = await requireMember();
  return {
    actor: { businessId: context.business.id, userId: context.user.id },
    isOwner: context.role === "owner",
  };
}

async function audit(
  who: Actor,
  action: AuditAction,
  entity: { type: string; id: string },
  details?: Record<string, unknown>,
) {
  await recordAudit({
    businessId: who.businessId,
    userId: who.userId,
    action,
    entityType: entity.type,
    entityId: entity.id,
    details,
    ipAddress: await clientIp(),
  });
}

function refresh(productId?: string) {
  revalidatePath("/");
  revalidatePath("/inventario");
  if (productId) revalidatePath(`/inventario/${productId}`);
}

function failure(error: unknown): ActionState {
  if (error instanceof StockError) {
    return error.code === "SKU_TAKEN"
      ? { fieldErrors: { sku: [error.message] } }
      : { error: error.message };
  }
  console.error("Error de inventario", error instanceof Error ? error.message : "desconocido");
  return { error: "No pudimos guardar el cambio. Inténtalo de nuevo." };
}

/* -------------------------------------------------------------------------- */
/* Productos                                                                   */
/* -------------------------------------------------------------------------- */

async function createProductImpl(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor: who, isOwner } = await actor();

  const parsed = newProductSchema.safeParse({
    name: text(formData, "name"),
    description: text(formData, "description"),
    categoryName: text(formData, "categoryName"),
    unit: text(formData, "unit") || "und",
    sku: text(formData, "sku"),
    priceCents: text(formData, "price"),
    costCents: isOwner ? text(formData, "cost") : "",
    minStockMilli: text(formData, "minStock"),
    initialStockMilli: text(formData, "initialStock"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  let productId: string;
  try {
    const created = await createProduct(who, parsed.data);
    productId = created.product.id;
    await audit(who, "product.created", { type: "product", id: productId }, {
      name: parsed.data.name,
      priceCents: parsed.data.priceCents,
      initialStockMilli: parsed.data.initialStockMilli,
    });
  } catch (error) {
    return failure(error);
  }

  refresh();
  redirect(`/inventario/${productId}`);
}

async function updateProductImpl(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor: who, isOwner } = await actor();
  const productId = idSchema.safeParse(text(formData, "productId"));
  if (!productId.success) return { error: "Producto inválido." };

  const parsed = productSchema.safeParse({
    name: text(formData, "name"),
    description: text(formData, "description"),
    categoryName: text(formData, "categoryName"),
    unit: text(formData, "unit") || "und",
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    const isActive = isOwner ? formData.get("isActive") === "on" : undefined;
    const result = await updateProduct(who, productId.data, {
      ...parsed.data,
      // Solo el dueño activa o desactiva productos.
      isActive,
    });
    const action: AuditAction =
      isActive === false && result.previousActive
        ? "product.deactivated"
        : isActive === true && !result.previousActive
          ? "product.reactivated"
          : "product.updated";
    await audit(who, action, { type: "product", id: productId.data }, { name: parsed.data.name });
  } catch (error) {
    return failure(error);
  }

  refresh(productId.data);
  return { success: "Producto actualizado." };
}

/* -------------------------------------------------------------------------- */
/* Variantes                                                                   */
/* -------------------------------------------------------------------------- */

async function addVariantImpl(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor: who, isOwner } = await actor();
  const productId = idSchema.safeParse(text(formData, "productId"));
  if (!productId.success) return { error: "Producto inválido." };

  const parsed = newVariantSchema.safeParse({
    name: text(formData, "name"),
    sku: text(formData, "sku"),
    priceCents: text(formData, "price"),
    costCents: isOwner ? text(formData, "cost") : "",
    minStockMilli: text(formData, "minStock"),
    initialStockMilli: text(formData, "initialStock"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    await addVariant(who, productId.data, parsed.data);
  } catch (error) {
    return failure(error);
  }

  refresh(productId.data);
  return { success: `Variante «${parsed.data.name}» agregada.` };
}

async function updateVariantImpl(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor: who, isOwner } = await actor();
  const productId = idSchema.safeParse(text(formData, "productId"));
  const variantId = idSchema.safeParse(text(formData, "variantId"));
  if (!productId.success || !variantId.success) return { error: "Variante inválida." };

  const parsed = updateVariantSchema.safeParse({
    name: text(formData, "name"),
    sku: text(formData, "sku"),
    priceCents: text(formData, "price"),
    costCents: isOwner ? text(formData, "cost") : "",
    minStockMilli: text(formData, "minStock"),
    isActive: formData.get("isActive") === "on",
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    const updated = await updateVariant(who, variantId.data, {
      ...parsed.data,
      name: parsed.data.name || null,
      costCents: isOwner ? parsed.data.costCents : undefined,
      // Solo el dueño activa o desactiva variantes.
      isActive: isOwner ? parsed.data.isActive : undefined,
    });
    if (updated.previousPriceCents !== updated.priceCents) {
      await audit(who, "variant.price_changed", { type: "variant", id: variantId.data }, {
        sku: updated.sku,
        fromCents: updated.previousPriceCents,
        toCents: updated.priceCents,
      });
    } else {
      await audit(who, "variant.updated", { type: "variant", id: variantId.data }, { sku: updated.sku });
    }
  } catch (error) {
    return failure(error);
  }

  refresh(productId.data);
  return { success: "Variante actualizada." };
}

/* -------------------------------------------------------------------------- */
/* Movimientos y reservas                                                      */
/* -------------------------------------------------------------------------- */

const movementMessages = {
  entry: "Entrada registrada.",
  exit: "Salida registrada.",
  adjustment: "Ajuste registrado.",
  reserve: "Reserva creada.",
} as const;

async function recordMovementImpl(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor: who } = await actor();
  const productId = idSchema.safeParse(text(formData, "productId"));

  const parsed = movementSchema.safeParse({
    kind: text(formData, "kind"),
    variantId: text(formData, "variantId"),
    qtyMilli: text(formData, "qty"),
    reason: text(formData, "reason"),
  });

  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      fieldErrors: {
        qty: fieldErrors.qtyMilli,
        reason: fieldErrors.reason,
        variantId: fieldErrors.variantId,
        kind: fieldErrors.kind,
      },
    };
  }

  const input = parsed.data;

  try {
    switch (input.kind) {
      case "entry":
        await recordEntry(who, input);
        break;
      case "exit":
        await recordExit(who, input);
        break;
      case "adjustment":
        {
          const movement = await recordAdjustment(who, {
            variantId: input.variantId,
            countedMilli: input.qtyMilli,
            reason: input.reason,
          });
          await audit(who, "stock.adjusted", { type: "variant", id: input.variantId }, {
            deltaMilli: movement.qty_milli,
            countedMilli: input.qtyMilli,
          });
        }
        break;
      case "reserve":
        await reserveStock(who, {
          variantId: input.variantId,
          qtyMilli: input.qtyMilli,
          reference: input.reason,
        });
        break;
    }
  } catch (error) {
    return failure(error);
  }

  refresh(productId.success ? productId.data : undefined);
  return { success: movementMessages[input.kind] };
}

async function closeReservationImpl(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor: who } = await actor();
  const productId = idSchema.safeParse(text(formData, "productId"));
  const reservationId = idSchema.safeParse(text(formData, "reservationId"));
  const outcome = z.enum(["released", "fulfilled"]).safeParse(text(formData, "outcome"));

  if (!reservationId.success || !outcome.success) return { error: "Reserva inválida." };

  try {
    await closeReservation(who, { reservationId: reservationId.data, outcome: outcome.data });
  } catch (error) {
    return failure(error);
  }

  refresh(productId.success ? productId.data : undefined);
  return {
    success: outcome.data === "fulfilled" ? "Reserva entregada." : "Reserva liberada.",
  };
}

/* -------------------------------------------------------------------------- */
/* Acciones públicas: si fallan, devuelven lo escrito para no perderlo.         */
/* -------------------------------------------------------------------------- */

type Impl = (previous: ActionState, formData: FormData) => Promise<ActionState>;

async function keepValues(impl: Impl, previous: ActionState, formData: FormData) {
  const result = await impl(previous, formData);
  return result.success ? result : { ...result, values: formValues(formData) };
}

export async function createProductAction(previous: ActionState, formData: FormData) {
  return keepValues(createProductImpl, previous, formData);
}

export async function updateProductAction(previous: ActionState, formData: FormData) {
  return keepValues(updateProductImpl, previous, formData);
}

export async function addVariantAction(previous: ActionState, formData: FormData) {
  return keepValues(addVariantImpl, previous, formData);
}

export async function updateVariantAction(previous: ActionState, formData: FormData) {
  return keepValues(updateVariantImpl, previous, formData);
}

export async function recordMovementAction(previous: ActionState, formData: FormData) {
  return keepValues(recordMovementImpl, previous, formData);
}

export async function closeReservationAction(previous: ActionState, formData: FormData) {
  return keepValues(closeReservationImpl, previous, formData);
}

/* -------------------------------------------------------------------------- */
/* Fotos                                                                       */
/* -------------------------------------------------------------------------- */

export async function uploadProductPhotoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor: who } = await actor();
  const productId = idSchema.safeParse(text(formData, "productId"));
  if (!productId.success) return { error: "Producto inválido." };
  if (!photosEnabled()) return { error: "Las fotos no están configuradas en este servidor." };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige una foto." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "La foto pesa más de 5 MB." };

  let key: string;
  try {
    const processed = await processProductPhoto(Buffer.from(await file.arrayBuffer()));
    key = newPhotoKey(who.businessId);
    await putPhoto(key, processed);
  } catch (error) {
    if (error instanceof ImageError) return { error: error.message };
    console.error("Error al subir foto", error instanceof Error ? error.message : "desconocido");
    return { error: "No pudimos guardar la foto. Inténtalo de nuevo." };
  }

  try {
    const { previousKey } = await setProductPhoto(who, productId.data, key);
    if (previousKey) await removePhoto(previousKey).catch(() => undefined);
  } catch (error) {
    await removePhoto(key).catch(() => undefined);
    return failure(error);
  }

  refresh(productId.data);
  return { success: "Foto actualizada." };
}

export async function removeProductPhotoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor: who } = await actor();
  const productId = idSchema.safeParse(text(formData, "productId"));
  if (!productId.success) return { error: "Producto inválido." };

  try {
    const { previousKey } = await setProductPhoto(who, productId.data, null);
    if (previousKey) await removePhoto(previousKey).catch(() => undefined);
  } catch (error) {
    return failure(error);
  }

  refresh(productId.data);
  return { success: "Foto eliminada." };
}
