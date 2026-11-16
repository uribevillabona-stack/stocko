import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, pool } from "@/lib/db/client";
import { account, memberships, products, productVariants, sales, user } from "@/lib/db/schema";
import { createBusinessForUser } from "@/server/services/business";
import { createCustomer } from "@/server/services/customers";
import { addPayment, createSale } from "@/server/services/sales";
import { addVariant, createProduct, reserveStock, updateVariant } from "@/server/services/inventory";

const PASSWORD = "stocko1234";
const OWNER_EMAIL = "duena@stocko.local";
const EMPLOYEE_EMAIL = "empleado@stocko.local";

async function createLocalUser(input: { name: string; email: string }): Promise<string> {
  const id = randomUUID();
  const password = await hashPassword(PASSWORD);

  await db.insert(user).values({
    id,
    name: input.name,
    email: input.email,
    emailVerified: true,
  });

  await db.insert(account).values({
    id: randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password,
  });

  return id;
}

/** Productos demo. Solo se crean si el negocio todavía no tiene productos. */
async function seedInventory(actor: { businessId: string; userId: string }) {
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.businessId, actor.businessId))
    .limit(1);
  if (existing) return;

  const base = { description: null, costCents: null };
  const arroz = await createProduct(actor, {
    ...base,
    name: "Arroz Diana 500 g",
    categoryName: "Granos",
    unit: "und",
    sku: "ARZ-500",
    priceCents: 3_200_00,
    costCents: 2_600_00,
    minStockMilli: 10_000,
    initialStockMilli: 24_000,
  });
  await createProduct(actor, {
    ...base,
    name: "Aceite Premier 1 l",
    categoryName: "Aceites",
    unit: "und",
    sku: "ACE-1000",
    priceCents: 11_500_00,
    minStockMilli: 6_000,
    initialStockMilli: 4_000,
  });
  await createProduct(actor, {
    ...base,
    name: "Queso campesino",
    categoryName: "Lácteos",
    unit: "kg",
    sku: "QSO-KG",
    priceCents: 22_000_00,
    minStockMilli: 2_000,
    initialStockMilli: 3_750,
  });
  const camiseta = await createProduct(actor, {
    ...base,
    name: "Camiseta Stocko",
    categoryName: "Ropa",
    unit: "und",
    sku: "CAM-S",
    priceCents: 35_000_00,
    minStockMilli: 2_000,
    initialStockMilli: 0,
  });
  await updateVariant(actor, camiseta.variant.id, {
    name: "Talla S",
    sku: "CAM-S",
    priceCents: 35_000_00,
    minStockMilli: 2_000,
    isActive: true,
  });
  await addVariant(actor, camiseta.product.id, {
    name: "Talla M",
    sku: "CAM-M",
    priceCents: 35_000_00,
    costCents: null,
    minStockMilli: 2_000,
    initialStockMilli: 8_000,
  });

  await reserveStock(actor, {
    variantId: arroz.variant.id,
    qtyMilli: 6_000,
    reference: "Doña Marta (pedido fiado)",
  });

  console.log("Inventario demo creado: 4 productos, 1 reserva.");
}

/** Clientes y ventas demo. Solo si el negocio todavía no tiene ventas. */
async function seedSales(actor: { businessId: string; userId: string }) {
  const [existing] = await db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.businessId, actor.businessId))
    .limit(1);
  if (existing) return;

  const variants = await db
    .select({ id: productVariants.id, sku: productVariants.sku, price: productVariants.priceCents })
    .from(productVariants)
    .where(eq(productVariants.businessId, actor.businessId));
  const bySku = new Map(variants.map((variant) => [variant.sku, variant]));
  const arroz = bySku.get("ARZ-500");
  const queso = bySku.get("QSO-KG");
  const camisa = bySku.get("CAM-M");
  if (!arroz || !queso || !camisa) return;

  const marta = await createCustomer(actor, {
    name: "Doña Marta",
    phone: "+573001234567",
    email: null,
    notes: "Paga los viernes.",
  });
  await createCustomer(actor, { name: "Pedro Ramírez", phone: "+573109876543", email: null, notes: null });

  await createSale(actor, {
    customerId: null,
    items: [
      { variantId: arroz.id, qtyMilli: 2000, unitPriceCents: arroz.price },
      { variantId: queso.id, qtyMilli: 500, unitPriceCents: queso.price },
    ],
    discountCents: 0,
    payment: { amountCents: 2 * arroz.price + queso.price / 2, method: "cash" },
    note: null,
  });
  const fiada = await createSale(actor, {
    customerId: marta.id,
    items: [{ variantId: camisa.id, qtyMilli: 1000, unitPriceCents: camisa.price }],
    discountCents: 0,
    payment: { amountCents: 1_000_000, method: "transfer" },
    note: "Fiado hasta el viernes",
  });
  await addPayment(actor, { saleId: fiada.id, amountCents: 500_000, method: "cash", note: "Abono" });

  console.log("Ventas demo creadas: 2 clientes, 2 ventas (una fiada).");
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("El seed solo debe ejecutarse en desarrollo.");
    process.exitCode = 1;
    return;
  }

  const [existingOwner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, OWNER_EMAIL))
    .limit(1);

  if (existingOwner) {
    const [membership] = await db
      .select({ businessId: memberships.businessId })
      .from(memberships)
      .where(eq(memberships.userId, existingOwner.id))
      .limit(1);
    if (membership) {
      const actor = { businessId: membership.businessId, userId: existingOwner.id };
      await seedInventory(actor);
      await seedSales(actor);
    }
    console.log(`El negocio demo ya existe. Entra con ${OWNER_EMAIL} / ${PASSWORD}`);
    return;
  }

  const ownerId = await createLocalUser({ name: "Ana Dueña", email: OWNER_EMAIL });

  const business = await db.transaction(async (tx) =>
    createBusinessForUser(tx, { userId: ownerId, name: "Tienda La Esquina" }),
  );

  const [ownerMembership] = await db
    .select({ businessId: memberships.businessId })
    .from(memberships)
    .where(eq(memberships.userId, ownerId))
    .limit(1);

  if (ownerMembership) {
    const employeeId = await createLocalUser({ name: "Carlos Empleado", email: EMPLOYEE_EMAIL });
    await db.insert(memberships).values({
      businessId: ownerMembership.businessId,
      userId: employeeId,
      role: "employee",
    });
  }

  await seedInventory({ businessId: business.id, userId: ownerId });
  await seedSales({ businessId: business.id, userId: ownerId });

  console.log("");
  console.log("Datos demo creados:");
  console.log(`  Negocio:  ${business.name}`);
  console.log(`  Dueña:    ${OWNER_EMAIL} / ${PASSWORD}`);
  console.log(`  Empleado: ${EMPLOYEE_EMAIL} / ${PASSWORD}`);
  console.log("");
}

try {
  await main();
} finally {
  await pool.end();
}
