import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { createBusinessForUser } from "@/server/services/business";
import { createCustomer } from "@/server/services/customers";
import { createProduct, type Actor } from "@/server/services/inventory";
import { getBalanceSnapshot, getMoneyReport } from "@/server/services/reports";
import { addPayment, cancelSale, createSale } from "@/server/services/sales";

async function createActor(name: string): Promise<Actor> {
  const userId = randomUUID();
  await db.insert(user).values({ id: userId, name, email: `${userId}@test.local` });
  const business = await db.transaction((tx) => createBusinessForUser(tx, { userId, name }));
  return { businessId: business.id, userId };
}

const range = () => ({
  from: new Date(Date.now() - 60 * 60 * 1000),
  to: new Date(Date.now() + 60 * 60 * 1000),
  timeZone: "America/Bogota",
});

beforeEach(async () => {
  await db.execute(sql.raw('TRUNCATE TABLE "businesses", "user" RESTART IDENTITY CASCADE'));
});

describe("reporte de dinero", () => {
  it("ventas, costo, margen, medios de pago y cartera", async () => {
    const actor = await createActor("Tienda");
    const other = await createActor("Otro negocio");
    const make = (a: Actor, name: string, cost: number | null) =>
      createProduct(a, {
        name, description: null, categoryName: null, unit: "und", sku: null,
        priceCents: 100000, costCents: cost, minStockMilli: 0, initialStockMilli: 100000,
      });
    const conCosto = await make(actor, "Con costo", 60000);
    const sinCosto = await make(actor, "Sin costo", null);
    const ajeno = await make(other, "Ajeno", 10);
    const ana = await createCustomer(actor, { name: "Ana", phone: null, email: null, notes: null });

    // Venta 1: 2 × $1.000 con costo, pagada en efectivo.
    await createSale(actor, {
      customerId: null,
      items: [{ variantId: conCosto.variant.id, qtyMilli: 2000, unitPriceCents: 100000 }],
      discountCents: 0, payment: { amountCents: 200000, method: "cash" }, note: null,
    });
    // Venta 2: fiada a Ana, 1 sin costo, abona $300 por transferencia.
    const fiada = await createSale(actor, {
      customerId: ana.id,
      items: [{ variantId: sinCosto.variant.id, qtyMilli: 1000, unitPriceCents: 100000 }],
      discountCents: 0, payment: null, note: null,
    });
    await addPayment(actor, { saleId: fiada.id, amountCents: 30000, method: "transfer", note: null });
    // Venta 3: anulada, no debe contar.
    const anulada = await createSale(actor, {
      customerId: null,
      items: [{ variantId: conCosto.variant.id, qtyMilli: 5000, unitPriceCents: 100000 }],
      discountCents: 0, payment: { amountCents: 500000, method: "card" }, note: null,
    });
    await cancelSale(actor, { saleId: anulada.id, reason: "Prueba" });
    // Otro negocio: no debe aparecer.
    await createSale(other, {
      customerId: null,
      items: [{ variantId: ajeno.variant.id, qtyMilli: 1000, unitPriceCents: 999900 }],
      discountCents: 0, payment: { amountCents: 999900, method: "cash" }, note: null,
    });

    const report = await getMoneyReport(actor.businessId, range());
    expect(report.count).toBe(2);
    expect(report.revenueCents).toBe(300000);
    expect(report.costCents).toBe(120000);
    expect(report.grossProfitCents).toBe(180000);
    expect(report.costCoverage).toBeCloseTo(2 / 3);
    expect(report.pendingCents).toBe(70000);
    expect(report.byMethod).toEqual([
      { method: "cash", count: 1, amountCents: 200000 },
      { method: "transfer", count: 1, amountCents: 30000 },
    ]);
    expect(report.topProducts.map((p) => [p.name, p.revenueCents, p.profitCents])).toEqual([
      ["Con costo", 200000, 80000],
      ["Sin costo", 100000, null],
    ]);
    expect(report.topCustomers.map((c) => c.name)).toEqual(["Ana"]);
    expect(report.byDay.reduce((sum, d) => sum + d.revenueCents, 0)).toBe(300000);

    const snapshot = await getBalanceSnapshot(actor.businessId);
    expect(snapshot.receivableCents).toBe(70000);
    expect(snapshot.debtors.map((d) => [d.name, d.cents])).toEqual([["Ana", 70000]]);
    // Stock: con costo 98 und × $600 ; sin costo 99 und (no suma a costo).
    expect(snapshot.inventoryCostCents).toBe(98 * 60000);
    expect(snapshot.inventoryPriceCents).toBe((98 + 99) * 100000);
    expect(snapshot.uncostedVariants).toBe(1);

    const empty = await getMoneyReport(actor.businessId, {
      from: new Date("2020-01-01T00:00:00Z"), to: new Date("2020-01-02T00:00:00Z"), timeZone: "America/Bogota",
    });
    expect(empty).toMatchObject({ count: 0, revenueCents: 0, marginRatio: null });
  });
});
