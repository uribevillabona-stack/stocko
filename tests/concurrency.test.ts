import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { inventoryMovements, productVariants, user } from "@/lib/db/schema";
import { createBusinessForUser } from "@/server/services/business";
import {
  addVariant,
  createProduct,
  expireDueReservations,
  recordEntry,
  reserveStock,
  updateVariant,
  type Actor,
} from "@/server/services/inventory";
import { cancelSale, createSale } from "@/server/services/sales";

/**
 * Regresión de interbloqueos: ventas, anulaciones, movimientos, cambios de
 * precio y vencimiento de reservas al mismo tiempo sobre el mismo producto.
 * Con FOR UPDATE (en vez de FOR NO KEY UPDATE) Postgres abortaba alguna.
 */
async function createActor(): Promise<Actor> {
  const userId = randomUUID();
  await db.insert(user).values({ id: userId, name: "Dueña", email: `${userId}@test.local` });
  const business = await db.transaction((tx) => createBusinessForUser(tx, { userId, name: "Tienda" }));
  return { businessId: business.id, userId };
}

beforeEach(async () => {
  await db.execute(sql.raw('TRUNCATE TABLE "businesses", "user" RESTART IDENTITY CASCADE'));
});

describe("concurrencia sin interbloqueos", () => {
  it("ventas, anulaciones, entradas, precios y vencimientos simultáneos", async () => {
    const actor = await createActor();
    const { product, variant: small } = await createProduct(actor, {
      name: "Camiseta",
      description: null,
      categoryName: null,
      unit: "und",
      sku: "CAM-S",
      priceCents: 1000,
      costCents: 500,
      minStockMilli: 0,
      initialStockMilli: 1_000_000,
    });
    const medium = await addVariant(actor, product.id, {
      name: "M",
      sku: "CAM-M",
      priceCents: 1000,
      costCents: 500,
      minStockMilli: 0,
      initialStockMilli: 1_000_000,
    });
    const items = [
      { variantId: small.id, qtyMilli: 1000, unitPriceCents: 1000 },
      { variantId: medium.id, qtyMilli: 1000, unitPriceCents: 1000 },
    ];
    const sale = () =>
      createSale(actor, {
        customerId: null,
        items,
        discountCents: 0,
        payment: { amountCents: 2000, method: "cash" },
        note: null,
      });

    const errors: string[] = [];
    for (let round = 0; round < 6; round++) {
      const toCancel = await sale();
      await reserveStock(actor, {
        variantId: small.id,
        qtyMilli: 1000,
        reference: "Vencida",
        now: new Date(Date.now() - 48 * 3600 * 1000),
      });
      const results = await Promise.allSettled([
        sale(),
        sale(),
        cancelSale(actor, { saleId: toCancel.id, reason: "Prueba" }),
        recordEntry(actor, { variantId: medium.id, qtyMilli: 1000, reason: null }),
        recordEntry(actor, { variantId: small.id, qtyMilli: 1000, reason: null }),
        updateVariant(actor, medium.id, { name: "M", sku: "CAM-M", priceCents: 1000 + round, minStockMilli: 0 }),
        expireDueReservations(actor.businessId),
      ]);
      for (const result of results) {
        if (result.status === "rejected") errors.push(String((result.reason as Error).message));
      }
    }
    expect(errors).toEqual([]);

    // El libro de movimientos cuadra con el saldo de cada variante.
    for (const id of [small.id, medium.id]) {
      const [ledger] = await db
        .select({
          total: sql<string>`coalesce(sum(${inventoryMovements.qty_milli}) filter (where ${inventoryMovements.type} in ('entry', 'exit', 'adjustment')), 0)`,
        })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.variantId, id));
      const [row] = await db
        .select({ qty: productVariants.qty_milli, reserved: productVariants.reservedMilli })
        .from(productVariants)
        .where(eq(productVariants.id, id));
      expect(Number(ledger?.total)).toBe(row?.qty);
      expect(row?.reserved).toBe(0);
    }
  });
});
