import { createHmac, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { whatsappConfig, whatsappMessages, user } from "@/lib/db/schema";
import { createBusinessForUser } from "@/server/services/business";
import { getPublicCatalog, slugify } from "@/server/services/catalog";
import { createProduct, reserveStock, type Actor } from "@/server/services/inventory";
import {
  getWhatsappSettings,
  handleWebhook,
  sendWhatsappText,
  updateCatalogSettings,
  updateWhatsappSettings,
  verifySignature,
  verifyWebhookSubscription,
  WhatsappError,
} from "@/server/services/whatsapp";

const APP_SECRET = "app-secret-de-prueba";
const PHONE_ID = "1234567890";
const CUSTOMER = "+573001234567";

async function createActor(name: string): Promise<Actor> {
  const userId = randomUUID();
  await db.insert(user).values({ id: userId, name, email: `${userId}@test.local` });
  const business = await db.transaction((tx) => createBusinessForUser(tx, { userId, name }));
  return { businessId: business.id, userId };
}

async function enableCloud(actor: Actor, cap = 900) {
  await updateWhatsappSettings(actor, {
    mode: "cloud",
    phoneNumberId: PHONE_ID,
    wabaId: null,
    accessToken: "token-secreto",
    appSecret: APP_SECRET,
    messagesEnabled: true,
    messageCap: cap,
  });
}

function sign(body: string, secret = APP_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function inboundPayload(phoneNumberId = PHONE_ID, from = "573001234567", id = `wamid.${randomUUID()}`) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [{ from, id, type: "text", timestamp: String(Math.floor(Date.now() / 1000)) }],
            },
          },
        ],
      },
    ],
  });
}

function fakeFetch(response: { ok: boolean; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), { status: response.ok ? 200 : 400 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function expectCode(promise: Promise<unknown>, code: WhatsappError["code"]) {
  await expect(promise).rejects.toSatisfy((error: unknown) => error instanceof WhatsappError && error.code === code);
}

beforeEach(async () => {
  await db.execute(sql.raw('TRUNCATE TABLE "businesses", "user" RESTART IDENTITY CASCADE'));
});

describe("firma del webhook", () => {
  it("acepta solo la firma correcta", () => {
    const body = '{"a":1}';
    expect(verifySignature(body, sign(body), APP_SECRET)).toBe(true);
    expect(verifySignature(body, sign(body, "otro"), APP_SECRET)).toBe(false);
    expect(verifySignature(`${body} `, sign(body), APP_SECRET)).toBe(false);
    expect(verifySignature(body, null, APP_SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=zz", APP_SECRET)).toBe(false);
  });
});

describe("configuración", () => {
  it("cifra secretos, no los devuelve y exige datos para la Cloud API", async () => {
    const actor = await createActor("Tienda");
    await expectCode(
      updateWhatsappSettings(actor, {
        mode: "cloud", phoneNumberId: PHONE_ID, wabaId: null, accessToken: null, appSecret: null,
        messagesEnabled: true, messageCap: 900,
      }),
      "INVALID",
    );
    await enableCloud(actor);

    const [stored] = await db.select().from(whatsappConfig).where(eq(whatsappConfig.businessId, actor.businessId));
    expect(stored?.accessTokenEnc).toMatch(/^v1\./);
    expect(stored?.accessTokenEnc).not.toContain("token-secreto");
    expect(stored?.verifyToken).toBeTruthy();

    const settings = await getWhatsappSettings(actor.businessId);
    expect(settings).toMatchObject({ mode: "cloud", hasAccessToken: true, hasAppSecret: true, messagesEnabled: true });
    expect(JSON.stringify(settings)).not.toContain("token-secreto");

    // Sin enviar secretos nuevos se conservan los guardados.
    await updateWhatsappSettings(actor, {
      mode: "cloud", phoneNumberId: PHONE_ID, wabaId: "waba", messagesEnabled: false, messageCap: 100,
    });
    expect(await getWhatsappSettings(actor.businessId)).toMatchObject({ hasAccessToken: true, messageCap: 100, messagesEnabled: false });
  });

  it("verifica la suscripción solo con el token correcto", async () => {
    const actor = await createActor("Tienda");
    await enableCloud(actor);
    const settings = await getWhatsappSettings(actor.businessId);
    const ok = await verifyWebhookSubscription(actor.businessId, { mode: "subscribe", token: settings.verifyToken, challenge: "123" });
    expect(ok).toBe("123");
    expect(await verifyWebhookSubscription(actor.businessId, { mode: "subscribe", token: "malo", challenge: "123" })).toBeNull();
  });
});

describe("webhook y envío", () => {
  it("registra entrantes firmados, ignora otro número y abre la ventana de 24 h", async () => {
    const actor = await createActor("Tienda");
    await enableCloud(actor);
    const { impl, calls } = fakeFetch({ ok: true, body: { messages: [{ id: "wamid.salida" }] } });

    // Sin mensaje del cliente: fuera de la ventana.
    await expectCode(sendWhatsappText(actor, { phone: CUSTOMER, body: "Hola", kind: "receipt" }, { fetchImpl: impl }), "OUTSIDE_WINDOW");

    const forged = inboundPayload();
    expect(await handleWebhook(actor.businessId, forged, sign(forged, "falso"))).toBe(false);
    const otherNumber = inboundPayload("999");
    expect(await handleWebhook(actor.businessId, otherNumber, sign(otherNumber))).toBe(true);
    expect(await db.select().from(whatsappMessages)).toHaveLength(0);

    const body = inboundPayload();
    expect(await handleWebhook(actor.businessId, body, sign(body))).toBe(true);
    expect(await handleWebhook(actor.businessId, body, sign(body))).toBe(true); // reintento de Meta: sin duplicar
    expect(await db.select().from(whatsappMessages)).toHaveLength(1);

    await sendWhatsappText(actor, { phone: CUSTOMER, body: "Tu recibo", kind: "receipt" }, { fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(`/${PHONE_ID}/messages`);
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ to: "573001234567", type: "text", text: { body: "Tu recibo" } });
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer token-secreto");

    // Estado entregado desde el webhook.
    const status = JSON.stringify({
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: "wamid.salida", status: "delivered" }] } }] }],
    });
    await handleWebhook(actor.businessId, status, sign(status));
    const [sent] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.direction, "outbound"));
    expect(sent?.status).toBe("delivered");

    // 25 horas después la ventana está cerrada.
    await expectCode(
      sendWhatsappText(actor, { phone: CUSTOMER, body: "Otro", kind: "text" }, { fetchImpl: impl, now: new Date(Date.now() + 25 * 3600 * 1000) }),
      "OUTSIDE_WINDOW",
    );
  });

  it("respeta el tope mensual y registra fallos de la API", async () => {
    const actor = await createActor("Tienda");
    await enableCloud(actor, 1);
    const body = inboundPayload();
    await handleWebhook(actor.businessId, body, sign(body));

    const failing = fakeFetch({ ok: false, body: { error: { message: "Token inválido" } } });
    await expectCode(sendWhatsappText(actor, { phone: CUSTOMER, body: "x", kind: "text" }, { fetchImpl: failing.impl }), "API_ERROR");

    // El fallido no cuenta para el tope.
    const ok = fakeFetch({ ok: true, body: { messages: [{ id: "wamid.1" }] } });
    await sendWhatsappText(actor, { phone: CUSTOMER, body: "x", kind: "text" }, { fetchImpl: ok.impl });
    await expectCode(sendWhatsappText(actor, { phone: CUSTOMER, body: "y", kind: "text" }, { fetchImpl: ok.impl }), "CAP_REACHED");
  });

  it("el tope mensual aguanta envíos simultáneos", async () => {
    const actor = await createActor("Tienda");
    await enableCloud(actor, 1);
    const body = inboundPayload();
    await handleWebhook(actor.businessId, body, sign(body));
    const ok = fakeFetch({ ok: true, body: { messages: [{ id: "wamid.x" }] } });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        sendWhatsappText(actor, { phone: CUSTOMER, body: "x", kind: "text" }, { fetchImpl: ok.impl }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(ok.calls).toHaveLength(1);
  });

  it("el webhook de un negocio no registra mensajes en otro", async () => {
    const a = await createActor("A");
    const b = await createActor("B");
    await enableCloud(a);
    const body = inboundPayload();
    // Firmado con el secreto de A pero enviado a la URL de B (sin Cloud API).
    expect(await handleWebhook(b.businessId, body, sign(body))).toBe(false);
    expect(await db.select().from(whatsappMessages)).toHaveLength(0);
  });
});

describe("catálogo público", () => {
  it("solo publica negocios activados y no expone costos ni cantidades", async () => {
    const actor = await createActor("Tienda");
    const { variant } = await createProduct(actor, {
      name: "Arroz", description: "500 g", categoryName: "Granos", unit: "und", sku: null,
      priceCents: 320000, costCents: 260000, minStockMilli: 0, initialStockMilli: 2000,
    });
    await createProduct(actor, {
      name: "Agotado", description: null, categoryName: null, unit: "und", sku: null,
      priceCents: 100, costCents: null, minStockMilli: 0, initialStockMilli: 0,
    });

    expect(slugify("Tienda La Ésquina!!")).toBe("tienda-la-esquina");
    await updateCatalogSettings(actor, { slug: "tienda-la-esquina", enabled: false });
    expect(await getPublicCatalog("tienda-la-esquina")).toBeNull();

    await updateCatalogSettings(actor, { slug: "tienda-la-esquina", enabled: true });
    let catalog = await getPublicCatalog("tienda-la-esquina");
    // Primero por categoría; los productos sin categoría van al final.
    expect(catalog?.items.map((item) => [item.name, item.variants[0]?.available])).toEqual([
      ["Arroz", true],
      ["Agotado", false],
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/260000|costCents|qtyMilli/);

    // Si todo lo disponible está reservado, se muestra como agotado.
    await reserveStock(actor, { variantId: variant.id, qtyMilli: 2000, reference: "Cliente" });
    catalog = await getPublicCatalog("tienda-la-esquina");
    expect(catalog?.items.find((item) => item.name === "Arroz")?.variants[0]?.available).toBe(false);

    const other = await createActor("Otro");
    await expectCode(updateCatalogSettings(other, { slug: "tienda-la-esquina", enabled: true }), "INVALID");
    expect(await getPublicCatalog("../etc")).toBeNull();
  });
});
