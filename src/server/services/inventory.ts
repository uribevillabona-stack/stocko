import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, exists, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { Transaction } from "@/lib/db/client";
import {
  businesses,
  inventoryMovements,
  productCategories,
  products,
  productVariants,
  stockReservations,
  user,
} from "@/lib/db/schema";
import type { MovementType, ProductVariant, ReservationStatus } from "@/lib/db/schema";
import { MAX_QTY_MILLI } from "@/lib/quantity";

/* -------------------------------------------------------------------------- */
/* Tipos y errores                                                             */
/* -------------------------------------------------------------------------- */

/** Quién actúa. `businessId` siempre sale de la sesión, nunca del cliente. */
export type Actor = { businessId: string; userId: string };

export type StockErrorCode =
  | "NOT_FOUND"
  | "INACTIVE"
  | "INSUFFICIENT_STOCK"
  | "NO_CHANGE"
  | "OUT_OF_RANGE"
  | "SKU_TAKEN"
  | "RESERVATION_CLOSED"
  | "HAS_RESERVATIONS"
  | "LAST_VARIANT";

export class StockError extends Error {
  constructor(
    public readonly code: StockErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StockError";
  }
}

export const DEFAULT_VARIANT_NAME = "Única";

export type StockStatus = "ok" | "low" | "out";

export function stockStatus(input: {
  qtyMilli: number;
  reservedMilli: number;
  minStockMilli: number;
}): StockStatus {
  const available = input.qtyMilli - input.reservedMilli;
  if (available <= 0) return "out";
  if (input.minStockMilli > 0 && available <= input.minStockMilli) return "low";
  return "ok";
}

/* -------------------------------------------------------------------------- */
/* Utilidades internas                                                         */
/* -------------------------------------------------------------------------- */

type LockedVariant = {
  id: string;
  productId: string;
  qtyMilli: number;
  reservedMilli: number;
  isActive: boolean;
  productActive: boolean;
};

type BusinessRules = { allowOversell: boolean; reservationTtlHours: number };

function pgErrorCode(error: unknown): { code?: string; constraint?: string } {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  for (const candidate of candidates) {
    const value = candidate as { code?: unknown; constraint?: unknown } | undefined;
    if (value && typeof value.code === "string") {
      return {
        code: value.code,
        constraint: typeof value.constraint === "string" ? value.constraint : undefined,
      };
    }
  }
  return {};
}

function rethrowSkuConflict(error: unknown): never {
  const { code, constraint } = pgErrorCode(error);
  if (code === "23505" && constraint === "product_variants_sku_unique") {
    throw new StockError("SKU_TAKEN", "Ya tienes otra variante con ese código (SKU).");
  }
  throw error;
}

export function generateSku(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `SKU-${code}`;
}

async function getRules(tx: Transaction, businessId: string): Promise<BusinessRules> {
  const [rules] = await tx
    .select({
      allowOversell: businesses.allowOversell,
      reservationTtlHours: businesses.reservationTtlHours,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!rules) throw new StockError("NOT_FOUND", "No encontramos el negocio.");
  return rules;
}

/**
 * Bloquea la fila de la variante dentro del negocio.
 *
 * Todos los bloqueos de Stocko usan FOR NO KEY UPDATE: serializa igual que
 * FOR UPDATE entre operaciones de stock, pero no choca con el KEY SHARE que
 * toma Postgres al revisar claves foráneas (insertar un movimiento que apunta
 * al negocio, al producto o a la variante). Con FOR UPDATE esos chequeos
 * producían interbloqueos entre ventas, anulaciones y movimientos.
 */
async function lockVariant(
  tx: Transaction,
  businessId: string,
  variantId: string,
): Promise<LockedVariant> {
  const [row] = await tx
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      qtyMilli: productVariants.qty_milli,
      reservedMilli: productVariants.reservedMilli,
      isActive: productVariants.isActive,
      productActive: products.isActive,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.id, variantId), eq(productVariants.businessId, businessId)))
    .for("no key update", { of: productVariants });

  if (!row) throw new StockError("NOT_FOUND", "No encontramos esa variante.");
  return row;
}

function assertActive(variant: LockedVariant) {
  if (!variant.isActive || !variant.productActive) {
    throw new StockError("INACTIVE", "El producto o la variante están inactivos.");
  }
}

function assertRange(value: number) {
  if (Math.abs(value) > MAX_QTY_MILLI) {
    throw new StockError("OUT_OF_RANGE", "La cantidad supera el máximo permitido.");
  }
}

async function saveVariantBalances(tx: Transaction, variant: LockedVariant) {
  await tx
    .update(productVariants)
    .set({
      qty_milli: variant.qtyMilli,
      reservedMilli: variant.reservedMilli,
      updatedAt: new Date(),
    })
    .where(eq(productVariants.id, variant.id));
}

async function insertMovement(
  tx: Transaction,
  actor: { businessId: string; userId: string | null },
  variant: LockedVariant,
  input: {
    type: MovementType;
    qtyMilli: number;
    reason: string | null;
    reservationRef?: string | null;
  },
) {
  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      businessId: actor.businessId,
      productId: variant.productId,
      variantId: variant.id,
      reservationRef: input.reservationRef ?? null,
      type: input.type,
      qty_milli: input.qtyMilli,
      balanceAfterMilli: variant.qtyMilli,
      reason: input.reason,
      createdBy: actor.userId,
    })
    .returning();
  return movement!;
}

/** Cambia el stock físico de una variante ya bloqueada y registra el movimiento. */
async function applyPhysical(
  tx: Transaction,
  actor: Actor,
  variant: LockedVariant,
  input: {
    type: "entry" | "exit" | "adjustment";
    deltaMilli: number;
    reason: string | null;
    reservationRef?: string | null;
  },
) {
  const next = variant.qtyMilli + input.deltaMilli;
  assertRange(next);
  variant.qtyMilli = next;
  await saveVariantBalances(tx, variant);
  return insertMovement(tx, actor, variant, {
    type: input.type,
    qtyMilli: input.deltaMilli,
    reason: input.reason,
    reservationRef: input.reservationRef,
  });
}

/**
 * Vence las reservas activas cuya hora ya pasó para una variante bloqueada.
 * Libera lo reservado y deja un movimiento `release` por cada una.
 */
async function expireDueForVariant(
  tx: Transaction,
  businessId: string,
  variant: LockedVariant,
  now: Date,
): Promise<number> {
  const due = await tx
    .select({
      id: stockReservations.id,
      qtyMilli: stockReservations.qty_milli,
      reference: stockReservations.reservationId,
    })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.businessId, businessId),
        eq(stockReservations.variantId, variant.id),
        eq(stockReservations.status, "active"),
        lte(stockReservations.expiresAt, now),
      ),
    )
    .for("no key update");

  if (due.length === 0) return 0;

  await tx
    .update(stockReservations)
    .set({ status: "expired", closedAt: now })
    .where(
      inArray(
        stockReservations.id,
        due.map((row) => row.id),
      ),
    );

  for (const reservation of due) {
    variant.reservedMilli = Math.max(0, variant.reservedMilli - reservation.qtyMilli);
    await insertMovement(tx, { businessId, userId: null }, variant, {
      type: "release",
      qtyMilli: -reservation.qtyMilli,
      reason: `Reserva vencida: ${reservation.reference}`,
      reservationRef: reservation.id,
    });
  }

  await saveVariantBalances(tx, variant);
  return due.length;
}

function available(variant: LockedVariant): number {
  return variant.qtyMilli - variant.reservedMilli;
}

/* -------------------------------------------------------------------------- */
/* Movimientos de stock                                                        */
/* -------------------------------------------------------------------------- */

export async function recordEntry(
  actor: Actor,
  input: { variantId: string; qtyMilli: number; reason: string | null },
) {
  return db.transaction(async (tx) => {
    const variant = await lockVariant(tx, actor.businessId, input.variantId);
    assertActive(variant);
    await expireDueForVariant(tx, actor.businessId, variant, new Date());
    return applyPhysical(tx, actor, variant, {
      type: "entry",
      deltaMilli: input.qtyMilli,
      reason: input.reason,
    });
  });
}

export async function recordExit(
  actor: Actor,
  input: { variantId: string; qtyMilli: number; reason: string | null },
) {
  return db.transaction(async (tx) => {
    const variant = await lockVariant(tx, actor.businessId, input.variantId);
    assertActive(variant);
    const rules = await getRules(tx, actor.businessId);
    await expireDueForVariant(tx, actor.businessId, variant, new Date());

    if (!rules.allowOversell && input.qtyMilli > available(variant)) {
      throw new StockError(
        "INSUFFICIENT_STOCK",
        "No hay suficiente stock disponible. Lo reservado no se puede sacar.",
      );
    }

    return applyPhysical(tx, actor, variant, {
      type: "exit",
      deltaMilli: -input.qtyMilli,
      reason: input.reason,
    });
  });
}

/** Ajuste por conteo: el usuario escribe cuánto hay realmente. */
export async function recordAdjustment(
  actor: Actor,
  input: { variantId: string; countedMilli: number; reason: string | null },
) {
  return db.transaction(async (tx) => {
    const variant = await lockVariant(tx, actor.businessId, input.variantId);
    assertActive(variant);
    const rules = await getRules(tx, actor.businessId);
    await expireDueForVariant(tx, actor.businessId, variant, new Date());
    const delta = input.countedMilli - variant.qtyMilli;

    if (delta === 0) {
      throw new StockError("NO_CHANGE", "El conteo coincide con el stock actual. No hay nada que ajustar.");
    }

    // Sin sobreventa, el disponible nunca queda negativo: lo reservado debe existir.
    if (!rules.allowOversell && input.countedMilli < variant.reservedMilli) {
      throw new StockError(
        "INSUFFICIENT_STOCK",
        "El conteo es menor que lo reservado. Libera o entrega reservas antes de ajustar.",
      );
    }

    return applyPhysical(tx, actor, variant, {
      type: "adjustment",
      deltaMilli: delta,
      reason: input.reason,
    });
  });
}

export async function reserveStock(
  actor: Actor,
  input: { variantId: string; qtyMilli: number; reference: string; now?: Date },
) {
  return db.transaction(async (tx) => {
    const now = input.now ?? new Date();
    const variant = await lockVariant(tx, actor.businessId, input.variantId);
    assertActive(variant);
    const rules = await getRules(tx, actor.businessId);
    await expireDueForVariant(tx, actor.businessId, variant, now);

    if (!rules.allowOversell && input.qtyMilli > available(variant)) {
      throw new StockError("INSUFFICIENT_STOCK", "No hay suficiente stock disponible para reservar.");
    }

    const nextReserved = variant.reservedMilli + input.qtyMilli;
    assertRange(nextReserved);

    const [reservation] = await tx
      .insert(stockReservations)
      .values({
        businessId: actor.businessId,
        productId: variant.productId,
        variantId: variant.id,
        qty_milli: input.qtyMilli,
        reservationId: input.reference,
        status: "active",
        expiresAt: new Date(now.getTime() + rules.reservationTtlHours * 60 * 60 * 1000),
        createdBy: actor.userId,
      })
      .returning();

    variant.reservedMilli = nextReserved;
    await saveVariantBalances(tx, variant);
    await insertMovement(tx, actor, variant, {
      type: "reserve",
      qtyMilli: input.qtyMilli,
      reason: input.reference,
      reservationRef: reservation!.id,
    });

    return reservation!;
  });
}

/**
 * Cierra una reserva activa.
 * - `released`: se cancela y el stock vuelve a estar disponible.
 * - `fulfilled`: se entrega; lo reservado sale del stock físico.
 */
export async function closeReservation(
  actor: Actor,
  input: { reservationId: string; outcome: Extract<ReservationStatus, "released" | "fulfilled"> },
) {
  const [found] = await db
    .select({ variantId: stockReservations.variantId })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.id, input.reservationId),
        eq(stockReservations.businessId, actor.businessId),
      ),
    )
    .limit(1);

  if (!found?.variantId) throw new StockError("NOT_FOUND", "No encontramos esa reserva.");
  const variantId = found.variantId;

  // Los vencimientos se confirman en su propia transacción: si esta reserva ya
  // venció, el error de abajo no debe deshacer la liberación del stock.
  await db.transaction(async (tx) => {
    const variant = await lockVariant(tx, actor.businessId, variantId);
    await expireDueForVariant(tx, actor.businessId, variant, new Date());
  });

  return db.transaction(async (tx) => {
    const now = new Date();
    // Orden de bloqueo fijo (variante → reserva) para evitar interbloqueos.
    const variant = await lockVariant(tx, actor.businessId, variantId);

    const [reservation] = await tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.id, input.reservationId),
          eq(stockReservations.businessId, actor.businessId),
        ),
      )
      .for("no key update");

    if (!reservation) throw new StockError("NOT_FOUND", "No encontramos esa reserva.");
    if (reservation.status !== "active") {
      throw new StockError(
        "RESERVATION_CLOSED",
        reservation.status === "expired"
          ? "La reserva ya venció y el stock se liberó."
          : "La reserva ya estaba cerrada.",
      );
    }

    await tx
      .update(stockReservations)
      .set({ status: input.outcome, closedAt: now })
      .where(eq(stockReservations.id, reservation.id));

    variant.reservedMilli = Math.max(0, variant.reservedMilli - reservation.qty_milli);
    await saveVariantBalances(tx, variant);
    await insertMovement(tx, actor, variant, {
      type: "release",
      qtyMilli: -reservation.qty_milli,
      reason:
        input.outcome === "fulfilled"
          ? `Reserva entregada: ${reservation.reservationId}`
          : `Reserva cancelada: ${reservation.reservationId}`,
      reservationRef: reservation.id,
    });

    if (input.outcome === "fulfilled") {
      const rules = await getRules(tx, actor.businessId);
      if (!rules.allowOversell && variant.qtyMilli < reservation.qty_milli) {
        throw new StockError(
          "INSUFFICIENT_STOCK",
          "El stock físico es menor que la reserva. Revisa el conteo antes de entregar.",
        );
      }
      await applyPhysical(tx, actor, variant, {
        type: "exit",
        deltaMilli: -reservation.qty_milli,
        reason: `Entrega de reserva: ${reservation.reservationId}`,
        reservationRef: reservation.id,
      });
    }

    return { ...reservation, status: input.outcome };
  });
}

/** Vence todas las reservas pendientes del negocio. Se llama al cargar páginas. */
export async function expireDueReservations(businessId: string, now = new Date()) {
  const rows = await db
    .selectDistinct({ variantId: stockReservations.variantId })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.businessId, businessId),
        eq(stockReservations.status, "active"),
        lte(stockReservations.expiresAt, now),
      ),
    );

  let expired = 0;
  for (const row of rows) {
    if (!row.variantId) continue;
    const variantId = row.variantId;
    expired += await db.transaction(async (tx) => {
      const variant = await lockVariant(tx, businessId, variantId);
      return expireDueForVariant(tx, businessId, variant, now);
    });
  }
  return expired;
}

/* -------------------------------------------------------------------------- */
/* Productos y variantes                                                       */
/* -------------------------------------------------------------------------- */

async function resolveCategory(
  tx: Transaction,
  businessId: string,
  name: string | null,
): Promise<string | null> {
  if (!name) return null;
  await tx.insert(productCategories).values({ businessId, name }).onConflictDoNothing();
  const [category] = await tx
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(
      and(
        eq(productCategories.businessId, businessId),
        sql`lower(${productCategories.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return category?.id ?? null;
}

export type VariantFields = {
  sku: string | null;
  priceCents: number;
  costCents: number | null;
  minStockMilli: number;
};

export async function createProduct(
  actor: Actor,
  input: VariantFields & {
    name: string;
    description: string | null;
    categoryName: string | null;
    unit: string;
    initialStockMilli: number;
  },
) {
  try {
    return await db.transaction(async (tx) => {
      const categoryId = await resolveCategory(tx, actor.businessId, input.categoryName);

      const [product] = await tx
        .insert(products)
        .values({
          businessId: actor.businessId,
          categoryId,
          name: input.name,
          description: input.description,
          unit: input.unit,
        })
        .returning();

      const [variant] = await tx
        .insert(productVariants)
        .values({
          businessId: actor.businessId,
          productId: product!.id,
          sku: input.sku ?? generateSku(),
          name: DEFAULT_VARIANT_NAME,
          isDefault: true,
          priceCents: input.priceCents,
          costCents: input.costCents,
          minStockMilli: input.minStockMilli,
        })
        .returning();

      if (input.initialStockMilli > 0) {
        await applyPhysical(tx, actor, toLocked(variant!, true), {
          type: "entry",
          deltaMilli: input.initialStockMilli,
          reason: "Inventario inicial",
        });
      }

      return { product: product!, variant: variant! };
    });
  } catch (error) {
    rethrowSkuConflict(error);
  }
}

function toLocked(variant: ProductVariant, productActive: boolean): LockedVariant {
  return {
    id: variant.id,
    productId: variant.productId,
    qtyMilli: variant.qty_milli,
    reservedMilli: variant.reservedMilli,
    isActive: variant.isActive,
    productActive,
  };
}

export async function updateProduct(
  actor: Actor,
  productId: string,
  input: {
    name: string;
    description: string | null;
    categoryName: string | null;
    unit: string;
    isActive?: boolean;
  },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ isActive: products.isActive })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.businessId, actor.businessId)))
      .for("no key update");

    if (!current) throw new StockError("NOT_FOUND", "No encontramos ese producto.");

    if (current.isActive && input.isActive === false) {
      const [reserved] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.businessId, actor.businessId),
            eq(stockReservations.productId, productId),
            eq(stockReservations.status, "active"),
          ),
        );
      if ((reserved?.count ?? 0) > 0) {
        throw new StockError(
          "HAS_RESERVATIONS",
          "El producto tiene reservas activas. Libéralas o entrégalas antes de desactivarlo.",
        );
      }
    }

    const categoryId = await resolveCategory(tx, actor.businessId, input.categoryName);
    const [updated] = await tx
      .update(products)
      .set({
        name: input.name,
        description: input.description,
        categoryId,
        unit: input.unit,
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, productId), eq(products.businessId, actor.businessId)))
      .returning({ id: products.id });

    if (!updated) throw new StockError("NOT_FOUND", "No encontramos ese producto.");
    return { id: updated.id, previousActive: current.isActive };
  });
}

export async function addVariant(
  actor: Actor,
  productId: string,
  input: VariantFields & { name: string; initialStockMilli: number },
) {
  try {
    return await db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: products.id, isActive: products.isActive })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.businessId, actor.businessId)))
        .limit(1);

      if (!product) throw new StockError("NOT_FOUND", "No encontramos ese producto.");

      const [variant] = await tx
        .insert(productVariants)
        .values({
          businessId: actor.businessId,
          productId: product.id,
          sku: input.sku ?? generateSku(),
          name: input.name,
          isDefault: false,
          priceCents: input.priceCents,
          costCents: input.costCents,
          minStockMilli: input.minStockMilli,
        })
        .returning();

      if (input.initialStockMilli > 0) {
        await applyPhysical(tx, actor, toLocked(variant!, product.isActive), {
          type: "entry",
          deltaMilli: input.initialStockMilli,
          reason: "Inventario inicial",
        });
      }

      return variant!;
    });
  } catch (error) {
    rethrowSkuConflict(error);
  }
}

/**
 * `costCents` e `isActive` en `undefined` se dejan como están: los empleados no
 * ven ni cambian el costo, ni activan o desactivan variantes.
 */
export async function updateVariant(
  actor: Actor,
  variantId: string,
  input: Omit<VariantFields, "costCents"> & {
    costCents?: number | null;
    name: string | null;
    isActive?: boolean;
  },
) {
  try {
    return await db.transaction(async (tx) => {
      const locked = await lockVariant(tx, actor.businessId, variantId);
      const variant = locked;
      const isActive = input.isActive ?? locked.isActive;
      // Bloquea el producto (siempre después de la variante) para que dos
      // desactivaciones simultáneas no dejen el producto sin variantes activas.
      await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, locked.productId), eq(products.businessId, actor.businessId)))
        .for("no key update");
      const [current] = await tx
        .select({
          isDefault: productVariants.isDefault,
          sku: productVariants.sku,
          name: productVariants.name,
          priceCents: productVariants.priceCents,
        })
        .from(productVariants)
        .where(eq(productVariants.id, variant.id));

      if (variant.isActive && !isActive) {
        if (variant.reservedMilli > 0) {
          throw new StockError(
            "HAS_RESERVATIONS",
            "Esta variante tiene reservas activas. Libéralas o entrégalas antes de desactivarla.",
          );
        }
        const [others] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(productVariants)
          .where(
            and(
              eq(productVariants.productId, variant.productId),
              eq(productVariants.isActive, true),
              ne(productVariants.id, variant.id),
            ),
          );
        if ((others?.count ?? 0) === 0) {
          throw new StockError(
            "LAST_VARIANT",
            "Es la única variante activa. Desactiva el producto completo si ya no lo vendes.",
          );
        }
      }

      // Un nombre vacío vuelve a «Única» en la variante interna; en las demás se conserva.
      const name = input.name ?? (current?.isDefault ? DEFAULT_VARIANT_NAME : current?.name ?? null);

      const [updated] = await tx
        .update(productVariants)
        .set({
          name,
          sku: input.sku ?? current?.sku ?? generateSku(),
          priceCents: input.priceCents,
          ...(input.costCents === undefined ? {} : { costCents: input.costCents }),
          minStockMilli: input.minStockMilli,
          isActive,
          updatedAt: new Date(),
        })
        .where(eq(productVariants.id, variant.id))
        .returning();

      return { ...updated!, previousPriceCents: current?.priceCents ?? updated!.priceCents };
    });
  } catch (error) {
    rethrowSkuConflict(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

export type VariantStock = {
  id: string;
  name: string | null;
  sku: string;
  isDefault: boolean;
  isActive: boolean;
  qtyMilli: number;
  reservedMilli: number;
  availableMilli: number;
  minStockMilli: number;
  priceCents: number;
  costCents: number | null;
  status: StockStatus;
};

function toVariantStock(row: ProductVariant, includeCost = true): VariantStock {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    isDefault: row.isDefault,
    isActive: row.isActive,
    qtyMilli: row.qty_milli,
    reservedMilli: row.reservedMilli,
    availableMilli: row.qty_milli - row.reservedMilli,
    minStockMilli: row.minStockMilli,
    priceCents: row.priceCents,
    costCents: includeCost ? row.costCents : null,
    status: stockStatus({
      qtyMilli: row.qty_milli,
      reservedMilli: row.reservedMilli,
      minStockMilli: row.minStockMilli,
    }),
  };
}

export type InventoryFilter = "active" | "alerts" | "inactive";

export type ProductListItem = {
  id: string;
  name: string;
  unit: string;
  isActive: boolean;
  photoKey: string | null;
  categoryName: string | null;
  variants: VariantStock[];
  totals: { qtyMilli: number; reservedMilli: number; availableMilli: number };
  alertCount: number;
};

export async function listInventory(
  businessId: string,
  options: { q?: string; filter?: InventoryFilter } = {},
): Promise<ProductListItem[]> {
  const filter = options.filter ?? "active";
  const q = options.q?.trim().slice(0, 80);
  const pattern = q ? `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%` : null;

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      isActive: products.isActive,
      photoKey: products.photoKey,
      categoryName: productCategories.name,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(
      and(
        eq(products.businessId, businessId),
        eq(products.isActive, filter !== "inactive"),
        pattern
          ? or(
              ilike(products.name, pattern),
              ilike(productCategories.name, pattern),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(productVariants)
                  .where(
                    and(
                      eq(productVariants.productId, products.id),
                      or(ilike(productVariants.sku, pattern), ilike(productVariants.name, pattern)),
                    ),
                  ),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(products.name))
    .limit(300);

  if (productRows.length === 0) return [];

  const variantRows = await db
    .select()
    .from(productVariants)
    .where(
      and(
        eq(productVariants.businessId, businessId),
        inArray(
          productVariants.productId,
          productRows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(desc(productVariants.isDefault), asc(productVariants.createdAt));

  const byProduct = new Map<string, VariantStock[]>();
  for (const row of variantRows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push(toVariantStock(row, false));
    byProduct.set(row.productId, list);
  }

  const items = productRows.map((product) => {
    const variants = byProduct.get(product.id) ?? [];
    const active = variants.filter((variant) => variant.isActive);
    const totals = active.reduce(
      (acc, variant) => ({
        qtyMilli: acc.qtyMilli + variant.qtyMilli,
        reservedMilli: acc.reservedMilli + variant.reservedMilli,
        availableMilli: acc.availableMilli + variant.availableMilli,
      }),
      { qtyMilli: 0, reservedMilli: 0, availableMilli: 0 },
    );
    return {
      ...product,
      variants,
      totals,
      alertCount: active.filter((variant) => variant.status !== "ok").length,
    };
  });

  return filter === "alerts" ? items.filter((item) => item.alertCount > 0) : items;
}

export async function listCategoryNames(businessId: string): Promise<string[]> {
  const rows = await db
    .select({ name: productCategories.name })
    .from(productCategories)
    .where(and(eq(productCategories.businessId, businessId), eq(productCategories.isActive, true)))
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
  return rows.map((row) => row.name);
}

export async function getProductDetail(
  businessId: string,
  productId: string,
  options: { includeCost?: boolean } = {},
) {
  const [product] = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      unit: products.unit,
      isActive: products.isActive,
      photoKey: products.photoKey,
      createdAt: products.createdAt,
      categoryName: productCategories.name,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(and(eq(products.id, productId), eq(products.businessId, businessId)))
    .limit(1);

  if (!product) return null;

  const [variantRows, reservations, movements] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(
        and(eq(productVariants.productId, product.id), eq(productVariants.businessId, businessId)),
      )
      .orderBy(desc(productVariants.isDefault), asc(productVariants.createdAt)),
    db
      .select({
        id: stockReservations.id,
        variantId: stockReservations.variantId,
        variantName: productVariants.name,
        qtyMilli: stockReservations.qty_milli,
        reference: stockReservations.reservationId,
        expiresAt: stockReservations.expiresAt,
        createdAt: stockReservations.createdAt,
        createdByName: user.name,
      })
      .from(stockReservations)
      .leftJoin(productVariants, eq(productVariants.id, stockReservations.variantId))
      .leftJoin(user, eq(user.id, stockReservations.createdBy))
      .where(
        and(
          eq(stockReservations.businessId, businessId),
          eq(stockReservations.productId, product.id),
          eq(stockReservations.status, "active"),
        ),
      )
      .orderBy(asc(stockReservations.expiresAt)),
    db
      .select({
        id: inventoryMovements.id,
        type: inventoryMovements.type,
        qtyMilli: inventoryMovements.qty_milli,
        balanceAfterMilli: inventoryMovements.balanceAfterMilli,
        reason: inventoryMovements.reason,
        createdAt: inventoryMovements.createdAt,
        variantName: productVariants.name,
        createdByName: user.name,
      })
      .from(inventoryMovements)
      .leftJoin(productVariants, eq(productVariants.id, inventoryMovements.variantId))
      .leftJoin(user, eq(user.id, inventoryMovements.createdBy))
      .where(
        and(
          eq(inventoryMovements.businessId, businessId),
          eq(inventoryMovements.productId, product.id),
        ),
      )
      .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
      .limit(50),
  ]);

  return {
    product,
    // El costo solo sale del servidor para el dueño.
    variants: variantRows.map((row) => toVariantStock(row, options.includeCost ?? false)),
    reservations,
    movements,
  };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>;

export async function getInventoryOverview(businessId: string) {
  // bigint: con sobreventa, físico − reservado podría salirse del rango de integer.
  const availableExpr = sql<number>`(${productVariants.qty_milli}::bigint - ${productVariants.reservedMilli})`;

  const [counts, alerts, reservationTotals] = await Promise.all([
    db
      .select({
        products: sql<number>`count(distinct ${products.id})::int`,
        variants: sql<number>`count(${productVariants.id})::int`,
      })
      .from(products)
      .innerJoin(
        productVariants,
        and(eq(productVariants.productId, products.id), eq(productVariants.isActive, true)),
      )
      .where(and(eq(products.businessId, businessId), eq(products.isActive, true))),
    db
      .select({
        productId: products.id,
        productName: products.name,
        unit: products.unit,
        variantName: productVariants.name,
        isDefault: productVariants.isDefault,
        qtyMilli: productVariants.qty_milli,
        reservedMilli: productVariants.reservedMilli,
        minStockMilli: productVariants.minStockMilli,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(productVariants.businessId, businessId),
          eq(productVariants.isActive, true),
          eq(products.isActive, true),
          or(
            lte(availableExpr, 0),
            and(
              sql`${productVariants.minStockMilli} > 0`,
              lte(availableExpr, productVariants.minStockMilli),
            ),
          ),
        ),
      )
      .orderBy(asc(sql`${availableExpr} - ${productVariants.minStockMilli}`), asc(products.name))
      .limit(8),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(stockReservations)
      .where(
        and(eq(stockReservations.businessId, businessId), eq(stockReservations.status, "active")),
      ),
  ]);

  const [alertCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productVariants.businessId, businessId),
        eq(productVariants.isActive, true),
        eq(products.isActive, true),
        or(
          lte(availableExpr, 0),
          and(
            sql`${productVariants.minStockMilli} > 0`,
            lte(availableExpr, productVariants.minStockMilli),
          ),
        ),
      ),
    );

  return {
    productCount: counts[0]?.products ?? 0,
    variantCount: counts[0]?.variants ?? 0,
    activeReservations: reservationTotals[0]?.count ?? 0,
    alertCount: alertCount?.count ?? 0,
    alerts: alerts.map((row) => ({
      ...row,
      availableMilli: row.qtyMilli - row.reservedMilli,
      status: stockStatus(row),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Operaciones dentro de una transacción ajena (ventas)                        */
/* El que llama debe bloquear las variantes en orden de id para no interbloquear. */
/* -------------------------------------------------------------------------- */

/** Saca stock dentro de `tx`. Respeta la sobreventa y vence reservas antes. */
export async function exitStockInTx(
  tx: Transaction,
  actor: Actor,
  input: { variantId: string; qtyMilli: number; reason: string; allowOversell: boolean },
) {
  const variant = await lockVariant(tx, actor.businessId, input.variantId);
  assertActive(variant);
  await expireDueForVariant(tx, actor.businessId, variant, new Date());

  if (!input.allowOversell && input.qtyMilli > available(variant)) {
    throw new StockError(
      "INSUFFICIENT_STOCK",
      "No hay suficiente stock disponible para uno de los productos.",
    );
  }

  await applyPhysical(tx, actor, variant, {
    type: "exit",
    deltaMilli: -input.qtyMilli,
    reason: input.reason,
  });
  return variant;
}

/** Devuelve stock dentro de `tx` (por ejemplo, al anular una venta). */
export async function returnStockInTx(
  tx: Transaction,
  actor: Actor,
  input: { variantId: string; qtyMilli: number; reason: string },
) {
  const variant = await lockVariant(tx, actor.businessId, input.variantId);
  await applyPhysical(tx, actor, variant, {
    type: "entry",
    deltaMilli: input.qtyMilli,
    reason: input.reason,
  });
  return variant;
}

/* -------------------------------------------------------------------------- */
/* Fotos                                                                       */
/* -------------------------------------------------------------------------- */

/** Cambia la foto del producto y devuelve la clave anterior para borrarla. */
export async function setProductPhoto(actor: Actor, productId: string, photoKey: string | null) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ photoKey: products.photoKey })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.businessId, actor.businessId)))
      .for("no key update");
    if (!current) throw new StockError("NOT_FOUND", "No encontramos ese producto.");

    await tx
      .update(products)
      .set({ photoKey, updatedAt: new Date() })
      .where(eq(products.id, productId));
    return { previousKey: current.photoKey };
  });
}
