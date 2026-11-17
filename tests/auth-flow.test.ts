import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Server actions fuera de Next: encabezados, cookies y redirect simulados.
const cookieJar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => {
    const cookie = [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; ");
    return new Headers({ "x-forwarded-for": "127.0.0.1", ...(cookie ? { cookie } : {}) });
  },
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    has: (name: string) => cookieJar.has(name),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT ${to}`), { redirectTo: to });
  },
}));

const { registerAction, loginAction } = await import("@/actions/auth");
const { recoverPasswordAction } = await import("@/actions/recovery");
const { account, memberships, user } = await import("@/lib/db/schema");
const { db } = await import("@/lib/db/client");
const { env } = await import("@/lib/env");
const { initialActionState } = await import("@/lib/action-state");
const { RECOVERY_ACTION_URL, verifyRecoveryToken } = await import("@/lib/desktop-recovery");
const { listRecoverableAccounts } = await import("@/server/services/recovery");
const { dismissOwnerRecoveryNotice, ownerRecoveryNotice } = await import("@/server/services/recovery-notice");
// El token lo crea Stocko para Windows: misma implementación que usa el instalador.
const desktopRecovery = createRequire(import.meta.url)("../desktop/lib/recovery.cjs") as {
  RECOVERY_ACTION_URL: string;
  newRecoveryKey: () => string;
  createRecoveryToken: (key: string, now?: number) => string;
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function run(action: () => Promise<unknown>): Promise<{ redirectTo?: string; result?: unknown }> {
  try {
    return { result: await action() };
  } catch (error) {
    const redirectTo = (error as { redirectTo?: string }).redirectTo;
    if (redirectTo) return { redirectTo };
    throw error;
  }
}

async function count(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`));
  return (result.rows[0] as { n: number }).n;
}

const credentials = { email: "Ana@Tienda.com", password: "clave-segura-123" };
const register = (overrides: Record<string, string> = {}) =>
  run(() =>
    registerAction(
      initialActionState,
      form({ name: "Ana", businessName: "Tienda", ...credentials, confirmPassword: credentials.password, ...overrides }),
    ),
  );
const login = (password = credentials.password) =>
  run(() => loginAction(initialActionState, form({ email: credentials.email, password })));

const originalEnv = { desktop: env.STOCKO_DESKTOP, key: env.STOCKO_RECOVERY_KEY };

beforeEach(async () => {
  cookieJar.clear();
  await db.execute(
    sql.raw('TRUNCATE TABLE "businesses", "user", "rate_limit", "verification" RESTART IDENTITY CASCADE'),
  );
});

afterEach(() => {
  env.STOCKO_DESKTOP = originalEnv.desktop;
  env.STOCKO_RECOVERY_KEY = originalEnv.key;
});

describe("crear cuenta y entrar", () => {
  it("con la misma contraseña se puede volver a entrar", async () => {
    expect(await register()).toEqual({ redirectTo: "/" });
    expect(await count("session")).toBe(1);

    cookieJar.clear(); // como al cerrar sesión o abrir en otro equipo
    expect(await login()).toEqual({ redirectTo: "/" });
  });

  it("no crea la cuenta si las contraseñas no coinciden, y conserva lo escrito sin las contraseñas", async () => {
    const { result } = await register({ confirmPassword: "clave-segura-124" });
    expect(result).toMatchObject({
      fieldErrors: { confirmPassword: ["Las contraseñas no coinciden"] },
      values: { name: "Ana", businessName: "Tienda", email: "Ana@Tienda.com" },
    });
    const values = (result as { values: Record<string, string> }).values;
    expect(Object.keys(values).some((key) => /password/i.test(key))).toBe(false);
    expect(await count("user")).toBe(0);
  });

  it("al fallar la entrada conserva el correo, nunca la contraseña", async () => {
    await register();
    cookieJar.clear();
    const { result } = await login("otra-clave-999");
    expect(result).toMatchObject({ error: "Correo o contraseña incorrectos.", values: { email: "Ana@Tienda.com" } });
    expect((result as { values: Record<string, string> }).values).not.toHaveProperty("password");
  });
});

describe("recuperar la contraseña en Stocko para Windows", () => {
  const recover = (token: string, userId: string, password = "nueva-clave-456") =>
    run(() =>
      recoverPasswordAction(initialActionState, form({ token, userId, password, confirmPassword: password })),
    );

  async function desktopWithAccount() {
    env.STOCKO_DESKTOP = "1";
    env.STOCKO_RECOVERY_KEY = desktopRecovery.newRecoveryKey();
    await register();
    const [owner] = await listRecoverableAccounts();
    if (!owner) throw new Error("falta la cuenta del dueño");
    return { key: env.STOCKO_RECOVERY_KEY, userId: owner.id };
  }

  it("el enlace de Stocko y el de la página son el mismo", () => {
    expect(desktopRecovery.RECOVERY_ACTION_URL).toBe(RECOVERY_ACTION_URL);
  });

  it("el token de Stocko vale solo con su clave, sin cambios y antes de vencer", () => {
    const key = desktopRecovery.newRecoveryKey();
    const now = 1_800_000_000_000;
    const token = desktopRecovery.createRecoveryToken(key, now);

    expect(verifyRecoveryToken(token, key, now)).toMatchObject({ expiresAt: new Date(now + 15 * 60 * 1000) });
    expect(verifyRecoveryToken(token, desktopRecovery.newRecoveryKey(), now)).toBeNull();
    expect(verifyRecoveryToken(token, key, now + 15 * 60 * 1000)).toBeNull();
    expect(verifyRecoveryToken(token, undefined, now)).toBeNull();

    const [expires, nonce, signature] = token.split(".");
    expect(verifyRecoveryToken(`${Number(expires) + 60_000}.${nonce}.${signature}`, key, now)).toBeNull();
    expect(verifyRecoveryToken(`${expires}.${nonce}x.${signature}`, key, now)).toBeNull();
    // Firmado con la clave pero con un vencimiento lejano: no se acepta.
    expect(verifyRecoveryToken(desktopRecovery.createRecoveryToken(key, now + 60 * 60 * 1000), key, now)).toBeNull();
  });

  it("pone la contraseña nueva, cierra las sesiones y desbloquea los intentos fallidos", async () => {
    const { key, userId } = await desktopWithAccount();
    expect(await count("session")).toBe(1);
    cookieJar.clear();
    for (let i = 0; i < 3; i++) await login("me-equivoque-1");

    expect(await recover(desktopRecovery.createRecoveryToken(key), userId)).toEqual({
      redirectTo: "/login?recuperada=1",
    });
    expect(await count("session")).toBe(0);
    expect(await login()).toMatchObject({ result: { error: "Correo o contraseña incorrectos." } });
    expect(await login("nueva-clave-456")).toEqual({ redirectTo: "/" });

    const audit = await db.execute(sql.raw(`SELECT action FROM audit_events`));
    expect(audit.rows).toContainEqual({ action: "account.password_recovered" });
  });

  it("cada enlace sirve una sola vez", async () => {
    const { key, userId } = await desktopWithAccount();
    const token = desktopRecovery.createRecoveryToken(key);
    expect(await recover(token, userId)).toEqual({ redirectTo: "/login?recuperada=1" });
    expect(await recover(token, userId, "otra-clave-789")).toMatchObject({
      result: { error: expect.stringContaining("ya no sirve") },
    });
    expect(await login("otra-clave-789")).toMatchObject({ result: { error: "Correo o contraseña incorrectos." } });
  });

  it("dos envíos a la vez con el mismo enlace: solo uno cambia la contraseña", async () => {
    const { key, userId } = await desktopWithAccount();
    const token = desktopRecovery.createRecoveryToken(key);
    const results = await Promise.all([recover(token, userId, "primera-123"), recover(token, userId, "segunda-123")]);
    const winner = results.findIndex((r) => r.redirectTo === "/login?recuperada=1");
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(results[1 - winner]).toMatchObject({ result: { error: expect.stringContaining("ya no sirve") } });
    const passwords = ["primera-123", "segunda-123"];
    expect(await login(passwords[1 - winner])).toMatchObject({ result: { error: "Correo o contraseña incorrectos." } });
    expect(await login(passwords[winner])).toEqual({ redirectTo: "/" });
  });

  it("sirve también para la cuenta de un trabajador, y el dueño queda primero en la lista", async () => {
    const { key, userId: ownerId } = await desktopWithAccount();
    // Igual que «Crear un trabajador» (createEmployeeAction), sin simular la sesión del dueño.
    const employeeId = randomUUID();
    const [ownerMembership] = await db.select().from(memberships).where(eq(memberships.userId, ownerId));
    await db.insert(user).values({ id: employeeId, name: "Beto", email: "beto@tienda.com" });
    await db.insert(account).values({
      id: randomUUID(),
      accountId: employeeId,
      providerId: "credential",
      userId: employeeId,
      password: await hashPassword("inicial-123"),
    });
    await db.insert(memberships).values({ businessId: ownerMembership!.businessId, userId: employeeId, role: "employee" });
    const accounts = await listRecoverableAccounts();
    expect(accounts.map((a) => a.role)).toEqual(["owner", "employee"]);

    expect(await recover(desktopRecovery.createRecoveryToken(key), accounts[1]!.id, "beto-nueva-1")).toEqual({
      redirectTo: "/login?recuperada=1",
    });
    cookieJar.clear();
    expect(
      await run(() => loginAction(initialActionState, form({ email: "beto@tienda.com", password: "beto-nueva-1" }))),
    ).toEqual({ redirectTo: "/" });
    // La del dueño no cambió.
    cookieJar.clear();
    expect(await login()).toEqual({ redirectTo: "/" });
  });

  it("si la cuenta ya no existe lo dice y no gasta el enlace", async () => {
    const { key, userId } = await desktopWithAccount();
    const token = desktopRecovery.createRecoveryToken(key);
    expect(await recover(token, "no-existe")).toMatchObject({
      result: { fieldErrors: { userId: ["Esa cuenta ya no existe"] }, values: { userId: "no-existe" } },
    });
    expect(await recover(token, userId)).toEqual({ redirectTo: "/login?recuperada=1" });
  });

  it("pide confirmar la contraseña nueva", async () => {
    const { key, userId } = await desktopWithAccount();
    const { result } = await run(() =>
      recoverPasswordAction(
        initialActionState,
        form({ token: desktopRecovery.createRecoveryToken(key), userId, password: "nueva-1234", confirmPassword: "nueva-1235" }),
      ),
    );
    expect(result).toMatchObject({ fieldErrors: { confirmPassword: ["Las contraseñas no coinciden"] } });
    expect(await login()).toEqual({ redirectTo: "/" });
  });

  it("no existe en la versión web", async () => {
    const { key, userId } = await desktopWithAccount();
    env.STOCKO_DESKTOP = undefined;
    expect(await recover(desktopRecovery.createRecoveryToken(key), userId)).toMatchObject({
      result: { error: "Esto solo está en Stocko para Windows." },
    });
  });
});

describe("aviso al dueño cuando se recupera una contraseña de dueño", () => {
  async function setup() {
    env.STOCKO_DESKTOP = "1";
    env.STOCKO_RECOVERY_KEY = desktopRecovery.newRecoveryKey();
    await register();
    const [owner] = await listRecoverableAccounts();
    if (!owner) throw new Error("falta la cuenta del dueño");
    const [membership] = await db.select().from(memberships).where(eq(memberships.userId, owner.id));
    const employeeId = randomUUID();
    await db.insert(user).values({ id: employeeId, name: "Beto", email: "beto@tienda.com" });
    await db.insert(account).values({
      id: randomUUID(),
      accountId: employeeId,
      providerId: "credential",
      userId: employeeId,
      password: await hashPassword("inicial-123"),
    });
    await db.insert(memberships).values({ businessId: membership!.businessId, userId: employeeId, role: "employee" });
    const recoverAs = (userId: string, password: string) =>
      run(() =>
        recoverPasswordAction(
          initialActionState,
          form({ token: desktopRecovery.createRecoveryToken(env.STOCKO_RECOVERY_KEY!), userId, password, confirmPassword: password }),
        ),
      );
    return { ownerId: owner.id, employeeId, businessId: membership!.businessId, recoverAs };
  }

  it("sin recuperaciones no hay aviso, y recuperar la de un trabajador tampoco lo muestra", async () => {
    const { ownerId, employeeId, businessId, recoverAs } = await setup();
    expect(await ownerRecoveryNotice(businessId, ownerId)).toEqual([]);
    await recoverAs(employeeId, "beto-nueva-1");
    expect(await ownerRecoveryNotice(businessId, ownerId)).toEqual([]);
  });

  it("si alguien lo cerró, un cambio nuevo vuelve a mostrar también los anteriores", async () => {
    const { ownerId, businessId, recoverAs } = await setup();

    // Alguien recupera la cuenta del dueño, entra como dueño y cierra el aviso.
    await recoverAs(ownerId, "intruso-123");
    const first = await ownerRecoveryNotice(businessId, ownerId);
    expect(first.map((change) => change.email)).toEqual(["ana@tienda.com"]);
    await dismissOwnerRecoveryNotice(ownerId, first[0]!.at);
    expect(await ownerRecoveryNotice(businessId, ownerId)).toEqual([]);

    // El dueño real ya no puede entrar, recupera su contraseña y ve los dos cambios.
    await recoverAs(ownerId, "dueno-real-123");
    const both = await ownerRecoveryNotice(businessId, ownerId);
    expect(both).toHaveLength(2);
    expect(both[0]!.at.getTime()).toBeGreaterThanOrEqual(both[1]!.at.getTime());
  });

  it("los cambios de hace más de 30 días ya no salen", async () => {
    const { ownerId, businessId, recoverAs } = await setup();
    await recoverAs(ownerId, "dueno-real-123");
    const in31Days = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await ownerRecoveryNotice(businessId, ownerId, in31Days)).toEqual([]);
  });
});
