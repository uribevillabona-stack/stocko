import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  customers,
  payments,
  products,
  productVariants,
  saleItems,
  sales,
  user,
} from "@/lib/db/schema";
import type { PaymentMethod } from "@/lib/db/schema";

/**
 * Reportes de dinero (solo dueño). Ventas por fecha de venta; dinero recibido
 * por fecha de pago. Las ventas anuladas no cuentan.
 */
export async function getMoneyReport(
  businessId: string,
  input: { from: Date; to: Date; timeZone: string },
) {
  const inRange = and(
    eq(sales.businessId, businessId),
    eq(sales.status, "completed"),
    gte(sales.createdAt, input.from),
    lt(sales.createdAt, input.to),
  );
  const localDay = sql<string>`to_char(${sales.createdAt} at time zone ${input.timeZone}, 'YYYY-MM-DD')`;
  const lineCost = sql<number>`(${saleItems.unitCostCents}::numeric * ${saleItems.qtyMilli} / 1000)`;

  const [totals, lines, byDay, byMethod, topProducts, topCustomers, bySeller] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        revenueCents: sql<string>`coalesce(sum(${sales.totalCents}), 0)`,
        discountCents: sql<string>`coalesce(sum(${sales.discountCents}), 0)`,
        pendingCents: sql<string>`coalesce(sum(${sales.totalCents} - ${sales.paidCents}), 0)`,
      })
      .from(sales)
      .where(inRange),
    db
      .select({
        linesCents: sql<string>`coalesce(sum(${saleItems.lineTotalCents}), 0)`,
        costedLinesCents: sql<string>`coalesce(sum(${saleItems.lineTotalCents}) filter (where ${saleItems.unitCostCents} is not null), 0)`,
        costCents: sql<string>`coalesce(round(sum(${lineCost})), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(inRange),
    db
      .select({
        day: localDay,
        count: sql<number>`count(*)::int`,
        revenueCents: sql<string>`sum(${sales.totalCents})`,
      })
      .from(sales)
      .where(inRange)
      // Por posición: el parámetro de zona horaria se repetiría con otro número ($1, $6…)
      // y Postgres no reconocería la misma expresión en GROUP BY.
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        method: payments.method,
        count: sql<number>`count(*)::int`,
        amountCents: sql<string>`sum(${payments.amountCents})`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.businessId, businessId),
          isNull(payments.voidedAt),
          gte(payments.createdAt, input.from),
          lt(payments.createdAt, input.to),
        ),
      )
      .groupBy(payments.method),
    db
      .select({
        productId: saleItems.productId,
        name: sql<string>`max(${products.name})`,
        unit: sql<string>`max(${products.unit})`,
        qtyMilli: sql<string>`sum(${saleItems.qtyMilli})`,
        revenueCents: sql<string>`sum(${saleItems.lineTotalCents})`,
        costCents: sql<string | null>`round(sum(${lineCost}))`,
        uncosted: sql<number>`count(*) filter (where ${saleItems.unitCostCents} is null)::int`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .leftJoin(products, eq(products.id, saleItems.productId))
      .where(inRange)
      .groupBy(saleItems.productId)
      .orderBy(desc(sql`sum(${saleItems.lineTotalCents})`))
      .limit(10),
    db
      .select({
        customerId: sales.customerId,
        name: sql<string>`max(${customers.name})`,
        count: sql<number>`count(*)::int`,
        revenueCents: sql<string>`sum(${sales.totalCents})`,
      })
      .from(sales)
      .innerJoin(customers, eq(customers.id, sales.customerId))
      .where(inRange)
      .groupBy(sales.customerId)
      .orderBy(desc(sql`sum(${sales.totalCents})`))
      .limit(5),
    db
      .select({
        name: sql<string>`coalesce(max(${user.name}), 'Sin usuario')`,
        count: sql<number>`count(*)::int`,
        revenueCents: sql<string>`sum(${sales.totalCents})`,
      })
      .from(sales)
      .leftJoin(user, eq(user.id, sales.createdBy))
      .where(inRange)
      .groupBy(sales.createdBy)
      .orderBy(desc(sql`sum(${sales.totalCents})`)),
  ]);

  const revenue = Number(totals[0]?.revenueCents ?? 0);
  const count = totals[0]?.count ?? 0;
  const linesCents = Number(lines[0]?.linesCents ?? 0);
  const costedLines = Number(lines[0]?.costedLinesCents ?? 0);
  const cost = Number(lines[0]?.costCents ?? 0);
  const discount = Number(totals[0]?.discountCents ?? 0);

  // Margen bruto = ventas − costo de lo vendido. Los descuentos ya están en las
  // ventas. Las líneas sin costo cuentan como costo 0: se informa la cobertura.
  const grossProfit = revenue - cost;

  return {
    count,
    revenueCents: revenue,
    discountCents: discount,
    pendingCents: Number(totals[0]?.pendingCents ?? 0),
    averageTicketCents: count > 0 ? Math.round(revenue / count) : 0,
    costCents: cost,
    grossProfitCents: grossProfit,
    marginRatio: revenue > 0 ? grossProfit / revenue : null,
    costCoverage: linesCents > 0 ? costedLines / linesCents : 1,
    byDay: byDay.map((row) => ({ day: row.day, count: row.count, revenueCents: Number(row.revenueCents) })),
    byMethod: byMethod
      .map((row) => ({
        method: row.method as PaymentMethod,
        count: row.count,
        amountCents: Number(row.amountCents),
      }))
      .sort((a, b) => b.amountCents - a.amountCents),
    topProducts: topProducts.map((row) => {
      const revenueCents = Number(row.revenueCents);
      const costCents = row.costCents === null ? null : Number(row.costCents);
      return {
        productId: row.productId,
        name: row.name ?? "Producto eliminado",
        unit: row.unit ?? "und",
        qtyMilli: Number(row.qtyMilli),
        revenueCents,
        profitCents: costCents === null || row.uncosted > 0 ? null : revenueCents - costCents,
      };
    }),
    topCustomers: topCustomers.map((row) => ({
      customerId: row.customerId!,
      name: row.name,
      count: row.count,
      revenueCents: Number(row.revenueCents),
    })),
    bySeller: bySeller.map((row) => ({ name: row.name, count: row.count, revenueCents: Number(row.revenueCents) })),
  };
}

export type MoneyReport = Awaited<ReturnType<typeof getMoneyReport>>;

/** Fotografía actual (no depende del rango): cartera e inventario valorizado. */
export async function getBalanceSnapshot(businessId: string) {
  const [receivables, debtors, inventory] = await Promise.all([
    db
      .select({
        cents: sql<string>`coalesce(sum(${sales.totalCents} - ${sales.paidCents}), 0)`,
        sales: sql<number>`count(*)::int`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.businessId, businessId),
          eq(sales.status, "completed"),
          sql`${sales.paidCents} < ${sales.totalCents}`,
        ),
      ),
    db
      .select({
        customerId: customers.id,
        name: customers.name,
        phone: customers.phone,
        cents: sql<string>`sum(${sales.totalCents} - ${sales.paidCents})`,
        oldest: sql<Date>`min(${sales.createdAt})`,
      })
      .from(sales)
      .innerJoin(customers, eq(customers.id, sales.customerId))
      .where(
        and(
          eq(sales.businessId, businessId),
          eq(sales.status, "completed"),
          sql`${sales.paidCents} < ${sales.totalCents}`,
        ),
      )
      .groupBy(customers.id)
      .orderBy(desc(sql`sum(${sales.totalCents} - ${sales.paidCents})`))
      .limit(10),
    db
      .select({
        costCents: sql<string>`coalesce(round(sum(greatest(${productVariants.qty_milli}, 0)::numeric * ${productVariants.costCents} / 1000)), 0)`,
        priceCents: sql<string>`coalesce(round(sum(greatest(${productVariants.qty_milli}, 0)::numeric * ${productVariants.priceCents} / 1000)), 0)`,
        uncosted: sql<number>`count(*) filter (where ${productVariants.costCents} is null and ${productVariants.qty_milli} > 0)::int`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(productVariants.businessId, businessId),
          eq(productVariants.isActive, true),
          eq(products.isActive, true),
        ),
      ),
  ]);

  return {
    receivableCents: Number(receivables[0]?.cents ?? 0),
    receivableSales: receivables[0]?.sales ?? 0,
    debtors: debtors.map((row) => ({
      ...row,
      cents: Number(row.cents),
      oldest: new Date(row.oldest),
    })),
    inventoryCostCents: Number(inventory[0]?.costCents ?? 0),
    inventoryPriceCents: Number(inventory[0]?.priceCents ?? 0),
    uncostedVariants: inventory[0]?.uncosted ?? 0,
  };
}
