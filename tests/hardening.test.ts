import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listAuditEvents, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { clearRateLimit, hitRateLimit, isRateLimited } from "@/lib/rate-limit";
import { createBusinessForUser } from "@/server/services/business";

beforeEach(async () => {
  await db.execute(sql.raw('TRUNCATE TABLE "businesses", "user", "rate_limit" RESTART IDENTITY CASCADE'));
});

describe("límite de intentos", () => {
  it("ventana fija: bloquea al pasar el máximo y se reinicia aunque se siga intentando", async () => {
    const key = `test:${randomUUID()}`;
    const options = { max: 3, windowMs: 60_000, now: 1_000_000 };
    for (let i = 1; i <= 3; i++) {
      expect((await hitRateLimit(key, options)).allowed).toBe(true);
    }
    expect(await hitRateLimit(key, options)).toMatchObject({ allowed: false, count: 4 });
    expect(await isRateLimited(key, { ...options, now: 1_030_000 })).toBe(true);
    // Intentos durante el bloqueo no alargan la ventana (no hay bloqueo eterno).
    await hitRateLimit(key, { ...options, now: 1_059_000 });
    expect(await isRateLimited(key, { ...options, now: 1_060_000 })).toBe(false);
    expect(await hitRateLimit(key, { ...options, now: 1_060_000 })).toMatchObject({ allowed: true, count: 1 });
  });

  it("consultar no suma y limpiar desbloquea", async () => {
    const key = `test:${randomUUID()}`;
    const options = { max: 1, windowMs: 60_000 };
    expect(await isRateLimited(key, options)).toBe(false);
    await hitRateLimit(key, options);
    expect(await isRateLimited(key, options)).toBe(true);
    expect(await isRateLimited(key, options)).toBe(true);
    await clearRateLimit(key);
    expect(await isRateLimited(key, options)).toBe(false);
  });

  it("es atómico con intentos simultáneos", async () => {
    const key = `test:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => hitRateLimit(key, { max: 5, windowMs: 60_000 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Abre 10 conexiones nuevas a la vez: con Postgres local en Windows cada una
    // tarda ~0,5 s, así que los 5 s por defecto no alcanzan.
  }, 20_000);

  it("claves independientes", async () => {
    await hitRateLimit("a", { max: 1, windowMs: 60_000 });
    expect((await hitRateLimit("a", { max: 1, windowMs: 60_000 })).allowed).toBe(false);
    expect((await hitRateLimit("b", { max: 1, windowMs: 60_000 })).allowed).toBe(true);
  });
});

describe("auditoría", () => {
  it("registra por negocio sin cruzarlos", async () => {
    const make = async (name: string) => {
      const id = randomUUID();
      await db.insert(user).values({ id, name, email: `${id}@test.local` });
      const business = await db.transaction((tx) => createBusinessForUser(tx, { userId: id, name }));
      return { userId: id, businessId: business.id };
    };
    const a = await make("Ana");
    const b = await make("Beto");
    await recordAudit({ ...a, action: "sale.cancelled", details: { number: 1 } });
    await recordAudit({ ...b, action: "business.updated" });

    const events = await listAuditEvents(a.businessId);
    expect(events.map((e) => [e.action, e.userName])).toEqual([["sale.cancelled", "Ana"]]);
  });

  it("nunca rompe la acción principal", async () => {
    await expect(
      recordAudit({ businessId: randomUUID(), userId: null, action: "business.updated" }),
    ).resolves.toBeUndefined();
  });
});
