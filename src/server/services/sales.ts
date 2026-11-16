import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { Transaction } from "@/lib/db/client";
import {
  businesses,
  customers,
  payments,
  products,
  productVariants,
  saleItems,
  sales,
  user,
} from "@/lib/db/schema";
import type { PaymentMethod } from "@/lib/db/schema";
import { computeLineTotal, MAX_SALE_CENTS } from "@/lib/sale-math";
import {
  DEFAULT_VARIANT_NAME,
  exitStockInTx,
  returnStockInTx,
  type Actor,
} from "@/server/services/inventory";

export class SaleError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "EMPTY"
      | "DUPLICATE_ITEM"
      | "DISCOUNT_TOO_HIGH"
      | "PAYMENT_TOO_HIGH"
      | "CUSTOMER_REQUIRED"
      | "CANCELLED"
      | "ALREADY_PAID"
      | "OUT_OF_RANGE",
    message: string,
  ) {
    super(message);
    this.name = "SaleError";
  }
}

/** Total de una línea: cantidad (milésimas) × precio (centavos), redondeado. */
export function lineTotalCents(qtyMilli: number, unitPriceCents: number): number {
  const cents = computeLineTotal(qtyMilli, unitPriceCents);
  if (cents === null) {
    throw new SaleError("OUT_OF_RANGE", "El valor de la venta es demasiado alto.");
  }
  return cents;
}

export type SaleItemInput = { variantId: string; qtyMilli: number; unitPriceCents: number };

export type CreateSaleInput = {
  customerId: string | null;
  items: SaleItemInput[];
  discountCents: number;
  payment: { amountCents: number; method: PaymentMethod } | null;
  note: string | null;
};

/**
 * Crea una venta: numera, descuenta el stock de cada variante y registra el pago
 * inicial, todo en una transacción. Las variantes se bloquean en orden de id.
 */
export async function createSale(actor: Actor, input: CreateSaleInput) {
  if (input.items.length === 0) {
    throw new SaleError("EMPTY", "Agrega al menos un producto.");
  }
  const ids = new Set(input.items.map((item) => item.variantId));
  if (ids.size !== input.items.length) {
    throw new SaleError("DUPLICATE_ITEM", "Hay un producto repetido. Suma las cantidades en una sola línea.");
  }

  return db.transaction(async (tx) => {
    // Bloquear el negocio serializa la numeración de ventas (NO KEY UPDATE: no
    // bloquea los inserts de otras tablas que apuntan al negocio).
    const [business] = await tx
      .select({ allowOversell: businesses.allowOversell })
      .from(businesses)
      .where(eq(businesses.id, actor.businessId))
      .for("no key update");
    if (!business) throw new SaleError("NOT_FOUND", "No encontramos el negocio.");

    if (input.customerId) {
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, input.customerId),
            eq(customers.businessId, actor.businessId),
            eq(customers.isActive, true),
          ),
        )
        .limit(1);
      if (!customer) throw new SaleError("NOT_FOUND", "No encontramos ese cliente.");
    }

    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${sales.number}), 0)::int + 1` })
      .from(sales)
      .where(eq(sales.businessId, actor.businessId));

    const reason = `Venta #${next}`;
    let priceOverrides = 0;
    // Posición original de cada línea: se bloquea en orden de id, se muestra en el orden escrito.
    const order = new Map(input.items.map((item, index) => [item.variantId, index]));
    // Orden binario (igual que el de los uuid en Postgres), no localeCompare.
    const sorted = [...input.items].sort((a, b) =>
      a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
    );
    const lines: Array<{
      position: number;
      productId: string;
      variantId: string;
      description: string;
      qtyMilli: number;
      unitPriceCents: number;
      unitCostCents: number | null;
      lineTotalCents: number;
    }> = [];

    for (const item of sorted) {
      const variant = await exitStockInTx(tx, actor, {
        variantId: item.variantId,
        qtyMilli: item.qtyMilli,
        reason,
        allowOversell: business.allowOversell,
      });
      const [info] = await tx
        .select({
          productName: products.name,
          variantName: productVariants.name,
          isDefault: productVariants.isDefault,
          costCents: productVariants.costCents,
          listPriceCents: productVariants.priceCents,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(productVariants.id, variant.id));

      const variantSuffix =
        info && !info.isDefault && info.variantName && info.variantName !== DEFAULT_VARIANT_NAME
          ? ` · ${info.variantName}`
          : "";

      if (info && item.unitPriceCents !== info.listPriceCents) priceOverrides += 1;
      lines.push({
        position: order.get(item.variantId) ?? 0,
        productId: variant.productId,
        variantId: variant.id,
        description: `${info?.productName ?? "Producto"}${variantSuffix}`,
        qtyMilli: item.qtyMilli,
        unitPriceCents: item.unitPriceCents,
        unitCostCents: info?.costCents ?? null,
        lineTotalCents: lineTotalCents(item.qtyMilli, item.unitPriceCents),
      });
    }

    // Suma en BigInt: cada línea cabe en Number, pero la suma de muchas podría no caber.
    const subtotalBig = lines.reduce((sum, line) => sum + BigInt(line.lineTotalCents), 0n);
    if (subtotalBig > BigInt(MAX_SALE_CENTS)) {
      throw new SaleError("OUT_OF_RANGE", "El valor de la venta es demasiado alto.");
    }
    const subtotal = Number(subtotalBig);
    if (input.discountCents > subtotal) {
      throw new SaleError("DISCOUNT_TOO_HIGH", "El descuento no puede ser mayor que el subtotal.");
    }
    const total = subtotal - input.discountCents;
    const paid = input.payment?.amountCents ?? 0;

    if (paid > total) {
      throw new SaleError("PAYMENT_TOO_HIGH", "El pago no puede ser mayor que el total de la venta.");
    }
    if (paid < total && !input.customerId) {
      throw new SaleError(
        "CUSTOMER_REQUIRED",
        "Para dejar saldo pendiente (fiado) elige un cliente.",
      );
    }

    const [sale] = await tx
      .insert(sales)
      .values({
        businessId: actor.businessId,
        number: next,
        customerId: input.customerId,
        subtotalCents: subtotal,
        discountCents: input.discountCents,
        totalCents: total,
        paidCents: paid,
        note: input.note,
        createdBy: actor.userId,
      })
      .returning();

    await tx
      .insert(saleItems)
      .values(lines.map((line) => ({ ...line, businessId: actor.businessId, saleId: sale!.id })));

    if (input.payment && paid > 0) {
      await tx.insert(payments).values({
        businessId: actor.businessId,
        saleId: sale!.id,
        amountCents: paid,
        method: input.payment.method,
        createdBy: actor.userId,
      });
    }

    return { ...sale!, priceOverrides };
  });
}

async function lockSale(tx: Transaction, businessId: string, saleId: string) {
  const [sale] = await tx
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.businessId, businessId)))
    .for("no key update");
  if (!sale) throw new SaleError("NOT_FOUND", "No encontramos esa venta.");
  return sale;
}

/** Abona a una venta con saldo pendiente. */
export async function addPayment(
  actor: Actor,
  input: { saleId: string; amountCents: number; method: PaymentMethod; note: string | null },
) {
  return db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor.businessId, input.saleId);
    if (sale.status === "cancelled") throw new SaleError("CANCELLED", "La venta está anulada.");

    const balance = sale.totalCents - sale.paidCents;
    if (balance <= 0) throw new SaleError("ALREADY_PAID", "Esta venta ya está pagada.");
    if (input.amountCents > balance) {
      throw new SaleError("PAYMENT_TOO_HIGH", "El abono no puede ser mayor que el saldo pendiente.");
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        businessId: actor.businessId,
        saleId: sale.id,
        amountCents: input.amountCents,
        method: input.method,
        note: input.note,
        createdBy: actor.userId,
      })
      .returning();

    await tx
      .update(sales)
      .set({ paidCents: sale.paidCents + input.amountCents })
      .where(eq(sales.id, sale.id));

    return payment!;
  });
}

/**
 * Anula una venta: devuelve el stock y anula sus pagos (el dinero recibido se
 * debe devolver por fuera). Bloqueo: venta → variantes en orden de id.
 */
export async function cancelSale(actor: Actor, input: { saleId: string; reason: string }) {
  return db.transaction(async (tx) => {
    const sale = await lockSale(tx, actor.businessId, input.saleId);
    if (sale.status === "cancelled") throw new SaleError("CANCELLED", "La venta ya estaba anulada.");

    const items = await tx
      .select({ variantId: saleItems.variantId, qtyMilli: saleItems.qtyMilli })
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.id))
      .orderBy(asc(saleItems.variantId));

    for (const item of items) {
      if (!item.variantId) continue;
      await returnStockInTx(tx, actor, {
        variantId: item.variantId,
        qtyMilli: item.qtyMilli,
        reason: `Anulación venta #${sale.number}`,
      });
    }

    const now = new Date();
    await tx
      .update(payments)
      .set({ voidedAt: now })
      .where(and(eq(payments.saleId, sale.id), isNull(payments.voidedAt)));

    const [updated] = await tx
      .update(sales)
      .set({
        status: "cancelled",
        paidCents: 0,
        cancelledAt: now,
        cancelledBy: actor.userId,
        cancelReason: input.reason,
      })
      .where(eq(sales.id, sale.id))
      .returning();

    return { sale: updated!, refundCents: sale.paidCents };
  });
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

export type SaleFilter = "all" | "unpaid" | "cancelled";

export async function listSales(
  businessId: string,
  options: { filter?: SaleFilter; from?: Date; to?: Date; q?: string; limit?: number } = {},
) {
  const conditions: SQL[] = [eq(sales.businessId, businessId)];
  const filter = options.filter ?? "all";
  if (filter === "unpaid") {
    conditions.push(eq(sales.status, "completed"), sql`${sales.paidCents} < ${sales.totalCents}`);
  } else if (filter === "cancelled") {
    conditions.push(eq(sales.status, "cancelled"));
  }
  if (options.from) conditions.push(gte(sales.createdAt, options.from));
  if (options.to) conditions.push(lt(sales.createdAt, options.to));

  const q = options.q?.trim().replace(/^#/, "");
  if (q) {
    if (/^\d+$/.test(q)) {
      conditions.push(eq(sales.number, Number(q)));
    } else {
      conditions.push(sql`${customers.name} ilike ${`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`);
    }
  }

  return db
    .select({
      id: sales.id,
      number: sales.number,
      status: sales.status,
      totalCents: sales.totalCents,
      paidCents: sales.paidCents,
      createdAt: sales.createdAt,
      customerName: customers.name,
      itemCount: sql<number>`(select count(*)::int from ${saleItems} where ${saleItems.saleId} = ${sales.id})`,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt))
    .limit(options.limit ?? 200);
}

export async function getSaleDetail(
  businessId: string,
  saleId: string,
  options: { includeCost?: boolean } = {},
) {
  const [sale] = await db
    .select({
      sale: sales,
      customerName: customers.name,
      customerPhone: customers.phone,
      createdByName: user.name,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(user, eq(user.id, sales.createdBy))
    .where(and(eq(sales.id, saleId), eq(sales.businessId, businessId)))
    .limit(1);

  if (!sale) return null;

  const [items, salePayments] = await Promise.all([
    db
      .select({
        id: saleItems.id,
        productId: saleItems.productId,
        description: saleItems.description,
        qtyMilli: saleItems.qtyMilli,
        unitPriceCents: saleItems.unitPriceCents,
        unitCostCents: saleItems.unitCostCents,
        lineTotalCents: saleItems.lineTotalCents,
        unit: products.unit,
      })
      .from(saleItems)
      .leftJoin(products, eq(products.id, saleItems.productId))
      .where(eq(saleItems.saleId, sale.sale.id))
      .orderBy(asc(saleItems.position)),
    db
      .select({
        id: payments.id,
        amountCents: payments.amountCents,
        method: payments.method,
        note: payments.note,
        createdAt: payments.createdAt,
        voidedAt: payments.voidedAt,
        createdByName: user.name,
      })
      .from(payments)
      .leftJoin(user, eq(user.id, payments.createdBy))
      .where(eq(payments.saleId, sale.sale.id))
      .orderBy(asc(payments.createdAt)),
  ]);

  return {
    ...sale,
    items: items.map((item) => ({
      ...item,
      unitCostCents: options.includeCost ? item.unitCostCents : null,
    })),
    payments: salePayments,
    balanceCents: sale.sale.status === "completed" ? sale.sale.totalCents - sale.sale.paidCents : 0,
  };
}

export type SaleDetail = NonNullable<Awaited<ReturnType<typeof getSaleDetail>>>;

/** Variantes vendibles para el formulario de venta (sin costo). */
export async function listSellableVariants(businessId: string) {
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productName: products.name,
      variantName: productVariants.name,
      isDefault: productVariants.isDefault,
      sku: productVariants.sku,
      unit: products.unit,
      priceCents: productVariants.priceCents,
      qtyMilli: productVariants.qty_milli,
      reservedMilli: productVariants.reservedMilli,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productVariants.businessId, businessId),
        eq(productVariants.isActive, true),
        eq(products.isActive, true),
      ),
    )
    .orderBy(asc(products.name), desc(productVariants.isDefault), asc(productVariants.createdAt))
    .limit(2000);

  const variantsPerProduct = new Map<string, number>();
  for (const row of rows) {
    variantsPerProduct.set(row.productId, (variantsPerProduct.get(row.productId) ?? 0) + 1);
  }

  return rows.map((row) => ({
    variantId: row.variantId,
    label:
      (variantsPerProduct.get(row.productId) ?? 1) > 1
        ? `${row.productName} · ${row.variantName ?? row.sku}`
        : row.productName,
    sku: row.sku,
    unit: row.unit,
    priceCents: row.priceCents,
    availableMilli: row.qtyMilli - row.reservedMilli,
  }));
}

export type SellableVariant = Awaited<ReturnType<typeof listSellableVariants>>[number];

/** Totales de ventas en un rango (para Inicio). */
export async function getSalesSummary(businessId: string, from: Date, to: Date) {
  const [row] = await db
    .select({
      count: sql<number>`count(*) filter (where ${sales.status} = 'completed')::int`,
      totalCents: sql<number>`coalesce(sum(${sales.totalCents}) filter (where ${sales.status} = 'completed'), 0)::bigint`,
    })
    .from(sales)
    .where(and(eq(sales.businessId, businessId), gte(sales.createdAt, from), lt(sales.createdAt, to)));

  const [receivable] = await db
    .select({
      cents: sql<number>`coalesce(sum(${sales.totalCents} - ${sales.paidCents}), 0)::bigint`,
      customers: sql<number>`count(distinct ${sales.customerId})::int`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, businessId),
        eq(sales.status, "completed"),
        sql`${sales.paidCents} < ${sales.totalCents}`,
      ),
    );

  return {
    count: row?.count ?? 0,
    totalCents: Number(row?.totalCents ?? 0),
    receivableCents: Number(receivable?.cents ?? 0),
    receivableCustomers: receivable?.customers ?? 0,
  };
}

