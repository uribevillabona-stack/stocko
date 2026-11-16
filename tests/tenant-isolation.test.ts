import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { hashToken, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { invitations, memberships, user, whatsappConfig } from "@/lib/db/schema";
import { createBusinessForUser } from "@/server/services/business";
import { findInvitationByToken } from "@/server/services/invitations";

async function createTestUser(name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name,
    email: `${id}@test.local`,
  });
  return id;
}

async function createBusinessWithOwner(name: string) {
  const userId = await createTestUser(name);
  const business = await db.transaction((tx) =>
    createBusinessForUser(tx, { userId, name }),
  );
  return { userId, business };
}

beforeEach(async () => {
  await db.execute(
    sql.raw(
      'TRUNCATE TABLE "invitations", "whatsapp_config", "memberships", "session", "account", "verification", "user", "businesses" RESTART IDENTITY CASCADE',
    ),
  );
});

describe("aislamiento por negocio", () => {
  it("solo devuelve las pertenencias del negocio consultado", async () => {
    const a = await createBusinessWithOwner("Negocio A");
    const b = await createBusinessWithOwner("Negocio B");
    const employeeId = await createTestUser("Empleado A");

    await db.insert(memberships).values({
      businessId: a.business.id,
      userId: employeeId,
      role: "employee",
    });

    const fromA = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.businessId, a.business.id));

    const fromB = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.businessId, b.business.id));

    expect(fromA.map((row) => row.userId).sort()).toEqual([a.userId, employeeId].sort());
    expect(fromB.map((row) => row.userId)).toEqual([b.userId]);
  });

  it("impide que una cuenta pertenezca a dos negocios", async () => {
    const a = await createBusinessWithOwner("Negocio A");
    const b = await createBusinessWithOwner("Negocio B");

    await expect(
      db.insert(memberships).values({
        businessId: b.business.id,
        userId: a.userId,
        role: "employee",
      }),
    ).rejects.toThrow();
  });

  it("crea la configuración de WhatsApp con valores seguros", async () => {
    const a = await createBusinessWithOwner("Negocio A");

    const [config] = await db
      .select()
      .from(whatsappConfig)
      .where(eq(whatsappConfig.businessId, a.business.id));

    expect(config).toBeDefined();
    expect(config?.mode).toBe("basic");
    expect(config?.messagesEnabled).toBe(false);
    expect(config?.messageCap).toBe(900);
    expect(config?.accessTokenEnc).toBeNull();
  });
});

describe("invitaciones", () => {
  it("encuentra la invitación por token y no cruza negocios", async () => {
    const a = await createBusinessWithOwner("Negocio A");
    const b = await createBusinessWithOwner("Negocio B");
    const token = randomToken();

    await db.insert(invitations).values({
      businessId: a.business.id,
      email: "persona@test.local",
      role: "employee",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: a.userId,
    });

    const [stored] = await db
      .select({ tokenHash: invitations.tokenHash })
      .from(invitations)
      .where(eq(invitations.businessId, a.business.id));

    expect(stored?.tokenHash).not.toBe(token);

    const found = await findInvitationByToken(token);
    expect(found?.businessId).toBe(a.business.id);
    expect(found?.businessName).toBe("Negocio A");
    expect(await findInvitationByToken("token-inexistente")).toBeNull();

    const otherToken = randomToken();
    await db.insert(invitations).values({
      businessId: b.business.id,
      email: "otra@test.local",
      role: "employee",
      tokenHash: hashToken(otherToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: b.userId,
    });

    const other = await findInvitationByToken(otherToken);
    expect(other?.businessId).toBe(b.business.id);
    expect(other?.businessId).not.toBe(a.business.id);
  });

  it("ignora invitaciones vencidas", async () => {
    const a = await createBusinessWithOwner("Negocio A");
    const token = randomToken();

    await db.insert(invitations).values({
      businessId: a.business.id,
      email: "vencida@test.local",
      role: "employee",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() - 60 * 1000),
      createdBy: a.userId,
    });

    expect(await findInvitationByToken(token)).toBeNull();
  });
});
