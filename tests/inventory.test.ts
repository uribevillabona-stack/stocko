import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import {
  businesses,
  inventoryMovements,
  productVariants,
  stockReservations,
  user,
} from "@/lib/db/schema";
import { createBusinessForUser } from "@/server/services/business";
import {
  addVariant,
  closeReservation,
  createProduct,
  expireDueReservations,
  getInventoryOverview,
  getProductDetail,
  listInventory,
  recordAdjustment,
  recordEntry,
  recordExit,
  reserveStock,
  StockError,
  updateProduct,
  updateVariant,
  type Actor,
} from "@/server/services/inventory";

async function createActor(name: string): Promise<Actor> {
  const userId = randomUUID();
  await db.insert(user).values({ id: userId, name, email: `${userId}@test.local` });
  const business = await db.transaction((tx) => createBusinessForUser(tx, { userId, name }));
  return { businessId: business.id, userId };
}

async function newProduct(actor: Actor, overrides: Partial<Parameters<typeof createProduct>[1]> = {}) {
  const created = await createProduct(actor, {
    name: "Arroz Diana 500 g",
    description: null,
    categoryName: "Granos",
    unit: "und",
    sku: null,
    priceCents: 450000,
    costCents: 380000,
    minStockMilli: 5000,
    initialStockMilli: 10000,
    ...overrides,
  });
  return created;
}

async function balances(variantId: string) {
  const [row] = await db
    .select({ qty: productVariants.qty_milli, reserved: productVariants.reservedMilli })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  return row!;
}

async function expectStockError(promise: Promise<unknown>, code: StockError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof StockError && error.code === code,
  );
}

beforeEach(async () => {
  await db.execute(
    sql.raw(
      'TRUNCATE TABLE "inventory_movements", "stock_reservations", "product_variants", "products", "product_categories", "invitations", "whatsapp_config", "memberships", "session", "account", "verification", "user", "businesses" RESTART IDENTITY CASCADE',
    ),
  );
});

describe("productos", () => {
  it("crea el producto con su variante «Única» y el inventario inicial como movimiento", async () => {
    const actor = await createActor("Tienda");
    const { product, variant } = await newProduct(actor);

    expect(variant.isDefault).toBe(true);
    expect(variant.name).toBe("Única");
    expect(variant.sku).toMatch(/^SKU-[A-Z0-9]{6}$/);
    expect(await balances(variant.id)).toEqual({ qty: 10000, reserved: 0 });

    const detail = await getProductDetail(actor.businessId, product.id);
    expect(detail?.product.categoryName).toBe("Granos");
    expect(detail?.movements).toHaveLength(1);
    expect(detail?.movements[0]).toMatchObject({
      type: "entry",
      qtyMilli: 10000,
      balanceAfterMilli: 10000,
      reason: "Inventario inicial",
    });
  });

  it("reutiliza la categoría sin distinguir mayúsculas", async () => {
    const actor = await createActor("Tienda");
    await newProduct(actor, { categoryName: "Granos" });
    await newProduct(actor, { name: "Fríjol", categoryName: "GRANOS" });
    const [row] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from product_categories`,
    ).then((result) => result.rows);
    expect(row?.count).toBe(1);
  });

  it("rechaza un SKU repetido en el mismo negocio pero lo permite en otro", async () => {
    const a = await createActor("A");
    const b = await createActor("B");
    await newProduct(a, { sku: "ARZ-500" });
    await expectStockError(newProduct(a, { name: "Otro", sku: "arz-500" }), "SKU_TAKEN");
    await expect(newProduct(b, { sku: "ARZ-500" })).resolves.toBeDefined();
  });

  it("agrega variantes y no deja desactivar la única activa", async () => {
    const actor = await createActor("Tienda");
    const { product, variant } = await newProduct(actor, { initialStockMilli: 0 });

    await expectStockError(
      updateVariant(actor, variant.id, {
        name: null,
        sku: variant.sku,
        priceCents: 1,
        minStockMilli: 0,
        isActive: false,
      }),
      "LAST_VARIANT",
    );

    const second = await addVariant(actor, product.id, {
      name: "Grande",
      sku: null,
      priceCents: 900000,
      costCents: null,
      minStockMilli: 0,
      initialStockMilli: 3000,
    });
    expect(await balances(second.id)).toEqual({ qty: 3000, reserved: 0 });

    const updated = await updateVariant(actor, variant.id, {
      name: null,
      sku: variant.sku,
      priceCents: 1,
      minStockMilli: 0,
      isActive: false,
    });
    expect(updated.isActive).toBe(false);
    expect(updated.name).toBe("Única");
    expect(updated.costCents).toBe(380000);
  });
});

describe("movimientos de stock", () => {
  it("entradas, salidas y ajustes cambian el físico y dejan historial con saldo", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);

    await recordEntry(actor, { variantId: variant.id, qtyMilli: 2500, reason: "Proveedor" });
    await recordExit(actor, { variantId: variant.id, qtyMilli: 1500, reason: null });
    const adjustment = await recordAdjustment(actor, {
      variantId: variant.id,
      countedMilli: 9000,
      reason: "Conteo",
    });

    expect(adjustment.qty_milli).toBe(-2000);
    expect(adjustment.balanceAfterMilli).toBe(9000);
    expect(await balances(variant.id)).toEqual({ qty: 9000, reserved: 0 });

    const history = await db
      .select({ type: inventoryMovements.type, qty: inventoryMovements.qty_milli })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variant.id));
    expect(history.map((row) => row.qty).reduce((sum, qty) => sum + qty, 0)).toBe(9000);
  });

  it("no deja vender más de lo disponible si la sobreventa está apagada", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);

    await expectStockError(
      recordExit(actor, { variantId: variant.id, qtyMilli: 10001, reason: null }),
      "INSUFFICIENT_STOCK",
    );
    expect(await balances(variant.id)).toEqual({ qty: 10000, reserved: 0 });

    await db
      .update(businesses)
      .set({ allowOversell: true })
      .where(eq(businesses.id, actor.businessId));
    await recordExit(actor, { variantId: variant.id, qtyMilli: 12000, reason: null });
    expect(await balances(variant.id)).toEqual({ qty: -2000, reserved: 0 });
  });

  it("un ajuste sin diferencia no crea movimiento", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);
    await expectStockError(
      recordAdjustment(actor, { variantId: variant.id, countedMilli: 10000, reason: null }),
      "NO_CHANGE",
    );
  });

  it("salidas simultáneas nunca dejan el stock en negativo (FOR UPDATE)", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor, { initialStockMilli: 5000 });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        recordExit(actor, { variantId: variant.id, qtyMilli: 1000, reason: null }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(await balances(variant.id)).toEqual({ qty: 0, reserved: 0 });
  });

  it("no permite mover stock de otro negocio", async () => {
    const a = await createActor("A");
    const b = await createActor("B");
    const { variant } = await newProduct(a);

    await expectStockError(
      recordEntry(b, { variantId: variant.id, qtyMilli: 1000, reason: null }),
      "NOT_FOUND",
    );
    await expectStockError(
      reserveStock(b, { variantId: variant.id, qtyMilli: 1000, reference: "Intruso" }),
      "NOT_FOUND",
    );
    expect(await listInventory(b.businessId)).toEqual([]);
    expect(await balances(variant.id)).toEqual({ qty: 10000, reserved: 0 });
  });
});

describe("reservas", () => {
  it("reservar baja el disponible y no el físico", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);

    await reserveStock(actor, { variantId: variant.id, qtyMilli: 4000, reference: "Doña Marta" });
    expect(await balances(variant.id)).toEqual({ qty: 10000, reserved: 4000 });

    // Disponible = 6; no se pueden sacar 7 aunque haya 10 físicos.
    await expectStockError(
      recordExit(actor, { variantId: variant.id, qtyMilli: 7000, reason: null }),
      "INSUFFICIENT_STOCK",
    );
    await expectStockError(
      reserveStock(actor, { variantId: variant.id, qtyMilli: 6001, reference: "Otro" }),
      "INSUFFICIENT_STOCK",
    );
  });

  it("liberar devuelve el disponible y entregar descuenta el físico", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);

    const first = await reserveStock(actor, {
      variantId: variant.id,
      qtyMilli: 2000,
      reference: "Pedido 1",
    });
    const second = await reserveStock(actor, {
      variantId: variant.id,
      qtyMilli: 3000,
      reference: "Pedido 2",
    });

    await closeReservation(actor, { reservationId: first.id, outcome: "released" });
    expect(await balances(variant.id)).toEqual({ qty: 10000, reserved: 3000 });

    await closeReservation(actor, { reservationId: second.id, outcome: "fulfilled" });
    expect(await balances(variant.id)).toEqual({ qty: 7000, reserved: 0 });

    await expectStockError(
      closeReservation(actor, { reservationId: second.id, outcome: "released" }),
      "RESERVATION_CLOSED",
    );
  });

  it("las reservas vencidas se liberan solas", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const reservation = await reserveStock(actor, {
      variantId: variant.id,
      qtyMilli: 4000,
      reference: "Vieja",
      now: past,
    });
    expect(await balances(variant.id)).toEqual({ qty: 10000, reserved: 4000 });

    expect(await expireDueReservations(actor.businessId)).toBe(1);
    expect(await balances(variant.id)).toEqual({ qty: 10000, reserved: 0 });

    const [stored] = await db
      .select({ status: stockReservations.status })
      .from(stockReservations)
      .where(eq(stockReservations.id, reservation.id));
    expect(stored?.status).toBe("expired");

    await expectStockError(
      closeReservation(actor, { reservationId: reservation.id, outcome: "fulfilled" }),
      "RESERVATION_CLOSED",
    );
  });

  it("una salida libera antes las reservas vencidas de esa variante", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);
    await reserveStock(actor, {
      variantId: variant.id,
      qtyMilli: 10000,
      reference: "Vieja",
      now: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    await recordExit(actor, { variantId: variant.id, qtyMilli: 10000, reason: null });
    expect(await balances(variant.id)).toEqual({ qty: 0, reserved: 0 });
  });

  it("no deja desactivar una variante con reservas activas", async () => {
    const actor = await createActor("Tienda");
    const { product, variant } = await newProduct(actor);
    await addVariant(actor, product.id, {
      name: "Grande",
      sku: null,
      priceCents: 1,
      costCents: null,
      minStockMilli: 0,
      initialStockMilli: 0,
    });
    await reserveStock(actor, { variantId: variant.id, qtyMilli: 1000, reference: "Cliente" });

    await expectStockError(
      updateVariant(actor, variant.id, {
        name: null,
        sku: variant.sku,
        priceCents: 1,
        minStockMilli: 0,
        isActive: false,
      }),
      "HAS_RESERVATIONS",
    );
  });
});

describe("correcciones de la revisión", () => {
  it("sin sobreventa, un conteo no puede quedar por debajo de lo reservado", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);
    await reserveStock(actor, { variantId: variant.id, qtyMilli: 8000, reference: "Cliente" });

    await expectStockError(
      recordAdjustment(actor, { variantId: variant.id, countedMilli: 5000, reason: null }),
      "INSUFFICIENT_STOCK",
    );
    await recordAdjustment(actor, { variantId: variant.id, countedMilli: 8000, reason: null });
    expect(await balances(variant.id)).toEqual({ qty: 8000, reserved: 8000 });
  });

  it("cerrar una reserva vencida deja el vencimiento guardado aunque falle", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);
    const reservation = await reserveStock(actor, {
      variantId: variant.id,
      qtyMilli: 3000,
      reference: "Vieja",
      now: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    await expectStockError(
      closeReservation(actor, { reservationId: reservation.id, outcome: "fulfilled" }),
      "RESERVATION_CLOSED",
    );
    expect(await balances(variant.id)).toEqual({ qty: 10000, reserved: 0 });
  });

  it("no deja desactivar un producto con reservas activas", async () => {
    const actor = await createActor("Tienda");
    const { product, variant } = await newProduct(actor);
    await reserveStock(actor, { variantId: variant.id, qtyMilli: 1000, reference: "Cliente" });

    await expectStockError(
      updateProduct(actor, product.id, {
        name: "Arroz",
        description: null,
        categoryName: null,
        unit: "und",
        isActive: false,
      }),
      "HAS_RESERVATIONS",
    );
  });

  it("el costo solo sale del servidor cuando se pide", async () => {
    const actor = await createActor("Tienda");
    const { product } = await newProduct(actor);

    const employeeView = await getProductDetail(actor.businessId, product.id);
    const ownerView = await getProductDetail(actor.businessId, product.id, { includeCost: true });
    expect(employeeView?.variants[0]?.costCents).toBeNull();
    expect(ownerView?.variants[0]?.costCents).toBe(380000);
    const list = await listInventory(actor.businessId);
    expect(list[0]?.variants[0]?.costCents).toBeNull();
  });

  it("sin isActive, editar una variante no cambia su estado ni su costo", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor);
    const updated = await updateVariant(actor, variant.id, {
      name: null,
      sku: variant.sku,
      priceCents: 500000,
      minStockMilli: 0,
    });
    expect(updated.isActive).toBe(true);
    expect(updated.costCents).toBe(380000);
    expect(updated.priceCents).toBe(500000);
  });
});

describe("alertas de stock", () => {
  it("marca bajo mínimo y agotado, y los cuenta en el resumen", async () => {
    const actor = await createActor("Tienda");
    const low = await newProduct(actor, { name: "Bajo", minStockMilli: 5000, initialStockMilli: 4000 });
    await newProduct(actor, { name: "Agotado", minStockMilli: 0, initialStockMilli: 0 });
    await newProduct(actor, { name: "Bien", minStockMilli: 2000, initialStockMilli: 9000 });

    const overview = await getInventoryOverview(actor.businessId);
    expect(overview.productCount).toBe(3);
    expect(overview.alertCount).toBe(2);
    // Ordenadas por cuánto les falta: Bajo (4 − 5 = −1) antes que Agotado (0 − 0 = 0).
    expect(overview.alerts.map((alert) => [alert.productName, alert.status])).toEqual([
      ["Bajo", "low"],
      ["Agotado", "out"],
    ]);

    const alerts = await listInventory(actor.businessId, { filter: "alerts" });
    expect(alerts.map((item) => item.name).sort()).toEqual(["Agotado", "Bajo"]);

    const search = await listInventory(actor.businessId, { q: low.variant.sku.toLowerCase() });
    expect(search.map((item) => item.name)).toEqual(["Bajo"]);
  });

  it("una reserva puede disparar la alerta aunque el físico esté bien", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await newProduct(actor, { minStockMilli: 5000, initialStockMilli: 8000 });
    expect((await getInventoryOverview(actor.businessId)).alertCount).toBe(0);

    await reserveStock(actor, { variantId: variant.id, qtyMilli: 4000, reference: "Cliente" });
    expect((await getInventoryOverview(actor.businessId)).alertCount).toBe(1);
  });
});
