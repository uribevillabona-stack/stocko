import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { customers, sales } from "@/lib/db/schema";
import type { Actor } from "@/server/services/inventory";

export class CustomerError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "PHONE_TAKEN",
    message: string,
  ) {
    super(message);
    this.name = "CustomerError";
  }
}

export type CustomerInput = {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

function rethrowPhoneConflict(error: unknown): never {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  for (const candidate of candidates) {
    const value = candidate as { code?: string; constraint?: string } | undefined;
    if (value?.code === "23505" && value.constraint === "customers_phone_unique") {
      throw new CustomerError("PHONE_TAKEN", "Ya tienes un cliente con ese teléfono.");
    }
  }
  throw error;
}

/** Saldo por cobrar de ventas no anuladas (fiado). */
const balanceExpr = sql<number>`coalesce(sum(${sales.totalCents} - ${sales.paidCents}) filter (where ${sales.status} = 'completed'), 0)::bigint`;

export async function createCustomer(actor: Actor, input: CustomerInput) {
  try {
    const [customer] = await db
      .insert(customers)
      .values({ businessId: actor.businessId, ...input })
      .returning();
    return customer!;
  } catch (error) {
    rethrowPhoneConflict(error);
  }
}

export async function updateCustomer(
  actor: Actor,
  customerId: string,
  input: CustomerInput & { isActive: boolean },
) {
  try {
    const [customer] = await db
      .update(customers)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(customers.id, customerId), eq(customers.businessId, actor.businessId)))
      .returning();
    if (!customer) throw new CustomerError("NOT_FOUND", "No encontramos ese cliente.");
    return customer;
  } catch (error) {
    rethrowPhoneConflict(error);
  }
}

export type CustomerFilter = "active" | "debt" | "inactive";

export async function listCustomers(
  businessId: string,
  options: { q?: string; filter?: CustomerFilter } = {},
) {
  const filter = options.filter ?? "active";
  const q = options.q?.trim().slice(0, 80);
  const pattern = q ? `%${q.replace(/[\\%_]/g, (match) => `\\${match}`)}%` : null;
  const digits = q?.replace(/\D/g, "");

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      isActive: customers.isActive,
      balanceCents: balanceExpr,
      salesCount: sql<number>`count(${sales.id}) filter (where ${sales.status} = 'completed')::int`,
      lastSaleAt: sql<Date | null>`max(${sales.createdAt})`,
    })
    .from(customers)
    .leftJoin(sales, eq(sales.customerId, customers.id))
    .where(
      and(
        eq(customers.businessId, businessId),
        eq(customers.isActive, filter !== "inactive"),
        pattern
          ? or(
              ilike(customers.name, pattern),
              ilike(customers.email, pattern),
              digits && digits.length >= 3 ? ilike(customers.phone, `%${digits}%`) : undefined,
            )
          : undefined,
      ),
    )
    .groupBy(customers.id)
    .having(filter === "debt" ? sql`${balanceExpr} > 0` : undefined)
    .orderBy(filter === "debt" ? desc(balanceExpr) : asc(customers.name))
    .limit(300);

  return rows.map((row) => ({
    ...row,
    balanceCents: Number(row.balanceCents),
    lastSaleAt: row.lastSaleAt ? new Date(row.lastSaleAt) : null,
  }));
}

export async function listCustomerOptions(businessId: string) {
  return db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.isActive, true)))
    .orderBy(asc(customers.name))
    .limit(1000);
}

export async function getCustomerDetail(businessId: string, customerId: string) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)))
    .limit(1);
  if (!customer) return null;

  const [totals, recentSales] = await Promise.all([
    db
      .select({
        balanceCents: balanceExpr,
        purchasedCents: sql<number>`coalesce(sum(${sales.totalCents}) filter (where ${sales.status} = 'completed'), 0)::bigint`,
        salesCount: sql<number>`count(*) filter (where ${sales.status} = 'completed')::int`,
      })
      .from(sales)
      .where(and(eq(sales.businessId, businessId), eq(sales.customerId, customer.id))),
    db
      .select({
        id: sales.id,
        number: sales.number,
        status: sales.status,
        totalCents: sales.totalCents,
        paidCents: sales.paidCents,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .where(and(eq(sales.businessId, businessId), eq(sales.customerId, customer.id)))
      .orderBy(desc(sales.createdAt))
      .limit(50),
  ]);

  return {
    customer,
    balanceCents: Number(totals[0]?.balanceCents ?? 0),
    purchasedCents: Number(totals[0]?.purchasedCents ?? 0),
    salesCount: totals[0]?.salesCount ?? 0,
    sales: recentSales,
  };
}
