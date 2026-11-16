import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { businesses, payments, productVariants, user } from "@/lib/db/schema";
import { createBusinessForUser } from "@/server/services/business";
import {
  createCustomer,
  CustomerError,
  getCustomerDetail,
  listCustomers,
} from "@/server/services/customers";
import { createProduct, reserveStock, type Actor } from "@/server/services/inventory";
import {
  addPayment,
  cancelSale,
  createSale,
  getSaleDetail,
  getSalesSummary,
  lineTotalCents,
  listSales,
  SaleError,
} from "@/server/services/sales";
import { StockError } from "@/server/services/inventory";

async function createActor(name: string): Promise<Actor> {
  const userId = randomUUID();
  await db.insert(user).values({ id: userId, name, email: `${userId}@test.local` });
  const business = await db.transaction((tx) => createBusinessForUser(tx, { userId, name }));
  return { businessId: business.id, userId };
}

async function product(actor: Actor, name: string, stockMilli: number, priceCents = 100000) {
  const { variant } = await createProduct(actor, {
    name,
    description: null,
    categoryName: null,
    unit: "und",
    sku: null,
    priceCents,
    costCents: 60000,
    minStockMilli: 0,
    initialStockMilli: stockMilli,
  });
  return variant;
}

async function stock(variantId: string) {
  const [row] = await db
    .select({ qty: productVariants.qty_milli, reserved: productVariants.reservedMilli })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  return row!;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) =>
      (error instanceof SaleError || error instanceof StockError || error instanceof CustomerError) &&
      error.code === code,
  );
}

beforeEach(async () => {
  await db.execute(
    sql.raw('TRUNCATE TABLE "businesses", "user" RESTART IDENTITY CASCADE'),
  );
});

describe("líneas", () => {
  it("calcula el total con milésimas y redondea", () => {
    expect(lineTotalCents(1500, 1000000)).toBe(1500000); // 1,5 × $10.000
    expect(lineTotalCents(333, 100)).toBe(33); // 0,333 × $1 = 0,333 → 33 centavos
    // 1.000.000 unidades × $1.000.000 = $1 billón (1e14 centavos), exacto.
    expect(lineTotalCents(1_000_000_000, 100_000_000)).toBe(100_000_000_000_000);
    expect(() => lineTotalCents(2_000_000_000, 100_000_000_000)).toThrow(SaleError);
  });
});

describe("ventas", () => {
  it("numera, descuenta stock, guarda costo y registra el pago", async () => {
    const actor = await createActor("Tienda");
    const arroz = await product(actor, "Arroz", 10000, 320000);
    const aceite = await product(actor, "Aceite", 5000, 1150000);

    const sale = await createSale(actor, {
      customerId: null,
      items: [
        { variantId: aceite.id, qtyMilli: 2000, unitPriceCents: 1150000 },
        { variantId: arroz.id, qtyMilli: 3000, unitPriceCents: 300000 },
      ],
      discountCents: 50000,
      payment: { amountCents: 3150000, method: "cash" },
      note: null,
    });

    expect(sale.number).toBe(1);
    expect(sale.subtotalCents).toBe(3200000);
    expect(sale.totalCents).toBe(3150000);
    expect(sale.paidCents).toBe(3150000);
    expect(await stock(arroz.id)).toEqual({ qty: 7000, reserved: 0 });
    expect(await stock(aceite.id)).toEqual({ qty: 3000, reserved: 0 });

    const detail = await getSaleDetail(actor.businessId, sale.id, { includeCost: true });
    expect(detail?.items.map((item) => item.description)).toEqual(["Aceite", "Arroz"]);
    expect(detail?.items[0]?.unitCostCents).toBe(60000);
    expect(detail?.payments).toHaveLength(1);

    const second = await createSale(actor, {
      customerId: null,
      items: [{ variantId: arroz.id, qtyMilli: 1000, unitPriceCents: 320000 }],
      discountCents: 0,
      payment: { amountCents: 320000, method: "transfer" },
      note: null,
    });
    expect(second.number).toBe(2);
  });

  it("es atómica: si un producto no alcanza, no descuenta ninguno", async () => {
    const actor = await createActor("Tienda");
    const a = await product(actor, "A", 10000);
    const b = await product(actor, "B", 1000);

    await expectCode(
      createSale(actor, {
        customerId: null,
        items: [
          { variantId: a.id, qtyMilli: 5000, unitPriceCents: 100000 },
          { variantId: b.id, qtyMilli: 2000, unitPriceCents: 100000 },
        ],
        discountCents: 0,
        payment: { amountCents: 700000, method: "cash" },
        note: null,
      }),
      "INSUFFICIENT_STOCK",
    );
    expect(await stock(a.id)).toEqual({ qty: 10000, reserved: 0 });
    expect(await listSales(actor.businessId)).toHaveLength(0);
  });

  it("respeta lo reservado al vender", async () => {
    const actor = await createActor("Tienda");
    const a = await product(actor, "A", 5000);
    await reserveStock(actor, { variantId: a.id, qtyMilli: 4000, reference: "Otro cliente" });

    await expectCode(
      createSale(actor, {
        customerId: null,
        items: [{ variantId: a.id, qtyMilli: 2000, unitPriceCents: 100000 }],
        discountCents: 0,
        payment: { amountCents: 200000, method: "cash" },
        note: null,
      }),
      "INSUFFICIENT_STOCK",
    );
  });

  it("exige cliente para fiar y valida descuento y pago", async () => {
    const actor = await createActor("Tienda");
    const a = await product(actor, "A", 10000);
    const base = {
      customerId: null,
      items: [{ variantId: a.id, qtyMilli: 1000, unitPriceCents: 100000 }],
      note: null,
    };

    await expectCode(
      createSale(actor, { ...base, discountCents: 0, payment: null }),
      "CUSTOMER_REQUIRED",
    );
    await expectCode(
      createSale(actor, { ...base, discountCents: 100001, payment: null }),
      "DISCOUNT_TOO_HIGH",
    );
    await expectCode(
      createSale(actor, { ...base, discountCents: 0, payment: { amountCents: 100001, method: "cash" } }),
      "PAYMENT_TOO_HIGH",
    );
    await expectCode(
      createSale(actor, {
        ...base,
        items: [...base.items, ...base.items],
        discountCents: 0,
        payment: null,
      }),
      "DUPLICATE_ITEM",
    );
  });

  it("ventas simultáneas reciben números distintos y no sobrevenden", async () => {
    const actor = await createActor("Tienda");
    const a = await product(actor, "A", 3000);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createSale(actor, {
          customerId: null,
          items: [{ variantId: a.id, qtyMilli: 1000, unitPriceCents: 100000 }],
          discountCents: 0,
          payment: { amountCents: 100000, method: "cash" },
          note: null,
        }),
      ),
    );

    const ok = results.filter((result) => result.status === "fulfilled");
    expect(ok).toHaveLength(3);
    const numbers = ok.map((result) => (result as PromiseFulfilledResult<{ number: number }>).value.number);
    expect(new Set(numbers).size).toBe(3);
    expect(await stock(a.id)).toEqual({ qty: 0, reserved: 0 });
  });

  it("fiado: abonos hasta saldar y saldo del cliente", async () => {
    const actor = await createActor("Tienda");
    const a = await product(actor, "A", 10000);
    const marta = await createCustomer(actor, {
      name: "Doña Marta",
      phone: "+573001234567",
      email: null,
      notes: null,
    });

    const sale = await createSale(actor, {
      customerId: marta.id,
      items: [{ variantId: a.id, qtyMilli: 5000, unitPriceCents: 100000 }],
      discountCents: 0,
      payment: { amountCents: 100000, method: "cash" },
      note: null,
    });

    expect((await getCustomerDetail(actor.businessId, marta.id))?.balanceCents).toBe(400000);
    expect((await listSales(actor.businessId, { filter: "unpaid" })).map((s) => s.id)).toEqual([sale.id]);
    expect((await listCustomers(actor.businessId, { filter: "debt" })).map((c) => c.name)).toEqual([
      "Doña Marta",
    ]);

    await expectCode(
      addPayment(actor, { saleId: sale.id, amountCents: 400001, method: "cash", note: null }),
      "PAYMENT_TOO_HIGH",
    );
    await addPayment(actor, { saleId: sale.id, amountCents: 150000, method: "transfer", note: null });
    await addPayment(actor, { saleId: sale.id, amountCents: 250000, method: "cash", note: null });
    await expectCode(
      addPayment(actor, { saleId: sale.id, amountCents: 1, method: "cash", note: null }),
      "ALREADY_PAID",
    );

    expect((await getCustomerDetail(actor.businessId, marta.id))?.balanceCents).toBe(0);
    const summary = await getSalesSummary(
      actor.businessId,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
    );
    expect(summary).toMatchObject({ count: 1, totalCents: 500000, receivableCents: 0 });
  });

  it("anular devuelve el stock, anula pagos y no cuenta en saldos", async () => {
    const actor = await createActor("Tienda");
    const a = await product(actor, "A", 10000);
    const cliente = await createCustomer(actor, { name: "Juan", phone: null, email: null, notes: null });

    const sale = await createSale(actor, {
      customerId: cliente.id,
      items: [{ variantId: a.id, qtyMilli: 4000, unitPriceCents: 100000 }],
      discountCents: 0,
      payment: { amountCents: 100000, method: "cash" },
      note: null,
    });
    expect(await stock(a.id)).toEqual({ qty: 6000, reserved: 0 });

    const result = await cancelSale(actor, { saleId: sale.id, reason: "Error de cobro" });
    expect(result.refundCents).toBe(100000);
    expect(await stock(a.id)).toEqual({ qty: 10000, reserved: 0 });

    const voided = await db.select().from(payments).where(eq(payments.saleId, sale.id));
    expect(voided.every((payment) => payment.voidedAt !== null)).toBe(true);
    expect((await getCustomerDetail(actor.businessId, cliente.id))?.balanceCents).toBe(0);

    await expectCode(cancelSale(actor, { saleId: sale.id, reason: "Otra vez" }), "CANCELLED");
    await expectCode(
      addPayment(actor, { saleId: sale.id, amountCents: 1, method: "cash", note: null }),
      "CANCELLED",
    );
  });

  it("aísla negocios: ventas, clientes y productos ajenos", async () => {
    const a = await createActor("A");
    const b = await createActor("B");
    const productA = await product(a, "Solo de A", 10000);
    const customerA = await createCustomer(a, { name: "Cliente A", phone: null, email: null, notes: null });
    const sale = await createSale(a, {
      customerId: null,
      items: [{ variantId: productA.id, qtyMilli: 1000, unitPriceCents: 100000 }],
      discountCents: 0,
      payment: { amountCents: 100000, method: "cash" },
      note: null,
    });

    await expectCode(
      createSale(b, {
        customerId: null,
        items: [{ variantId: productA.id, qtyMilli: 1000, unitPriceCents: 1 }],
        discountCents: 0,
        payment: { amountCents: 1, method: "cash" },
        note: null,
      }),
      "NOT_FOUND",
    );
    const bProduct = await product(b, "De B", 1000);
    await expectCode(
      createSale(b, {
        customerId: customerA.id,
        items: [{ variantId: bProduct.id, qtyMilli: 1000, unitPriceCents: 1 }],
        discountCents: 0,
        payment: null,
        note: null,
      }),
      "NOT_FOUND",
    );
    expect(await getSaleDetail(b.businessId, sale.id)).toBeNull();
    await expectCode(cancelSale(b, { saleId: sale.id, reason: "Ajeno" }), "NOT_FOUND");
    await expectCode(
      addPayment(b, { saleId: sale.id, amountCents: 1, method: "cash", note: null }),
      "NOT_FOUND",
    );
    expect(await listCustomers(b.businessId)).toEqual([]);
  });

  it("sobreventa activada permite vender sin stock", async () => {
    const actor = await createActor("Tienda");
    const a = await product(actor, "A", 0);
    await db.update(businesses).set({ allowOversell: true }).where(eq(businesses.id, actor.businessId));
    await createSale(actor, {
      customerId: null,
      items: [{ variantId: a.id, qtyMilli: 2000, unitPriceCents: 100000 }],
      discountCents: 0,
      payment: { amountCents: 200000, method: "card" },
      note: null,
    });
    expect(await stock(a.id)).toEqual({ qty: -2000, reserved: 0 });
  });
});

describe("clientes", () => {
  it("teléfono único por negocio y búsqueda por nombre o número", async () => {
    const a = await createActor("A");
    const b = await createActor("B");
    await createCustomer(a, { name: "Ana Gómez", phone: "+573001112233", email: null, notes: null });
    await expectCode(
      createCustomer(a, { name: "Otra", phone: "+573001112233", email: null, notes: null }),
      "PHONE_TAKEN",
    );
    await expect(
      createCustomer(b, { name: "Ana en B", phone: "+573001112233", email: null, notes: null }),
    ).resolves.toBeDefined();

    expect((await listCustomers(a.businessId, { q: "gómez" })).map((c) => c.name)).toEqual(["Ana Gómez"]);
    expect((await listCustomers(a.businessId, { q: "1112233" })).map((c) => c.name)).toEqual(["Ana Gómez"]);
  });
});
