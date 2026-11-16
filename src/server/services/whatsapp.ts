import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { businesses, whatsappConfig, whatsappMessages } from "@/lib/db/schema";
import { localDateKey, startOfLocalDay } from "@/lib/dates";
import type { Actor } from "@/server/services/inventory";

/**
 * WhatsApp Cloud API (opcional). Reglas:
 * - Solo mensajes de servicio dentro de la ventana de 24 h desde el último
 *   mensaje del cliente. Sin plantillas de marketing.
 * - Tope mensual configurable (900 por defecto).
 * - Los secretos se guardan cifrados (AES-256-GCM) y nunca vuelven al cliente.
 * Fuera de esas condiciones se usa el modo básico (enlaces wa.me).
 */

export const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsappError extends Error {
  constructor(
    public readonly code:
      | "NOT_CONFIGURED"
      | "DISABLED"
      | "OUTSIDE_WINDOW"
      | "CAP_REACHED"
      | "NO_PHONE"
      | "INVALID"
      | "API_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "WhatsappError";
  }
}

type Fetch = typeof fetch;

/* -------------------------------------------------------------------------- */
/* Configuración                                                               */
/* -------------------------------------------------------------------------- */

async function ensureConfig(businessId: string) {
  await db.insert(whatsappConfig).values({ businessId }).onConflictDoNothing();
  const [config] = await db
    .select()
    .from(whatsappConfig)
    .where(eq(whatsappConfig.businessId, businessId))
    .limit(1);
  return config!;
}

/** Inicio del mes actual en la zona del negocio. */
async function monthStart(businessId: string, now: Date) {
  const [business] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const tz = business?.timezone ?? "America/Bogota";
  return startOfLocalDay(`${localDateKey(now, tz).slice(0, 8)}01`, tz);
}

export async function countOutboundThisMonth(businessId: string, now = new Date()) {
  const from = await monthStart(businessId, now);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.businessId, businessId),
        eq(whatsappMessages.direction, "outbound"),
        ne(whatsappMessages.status, "failed"),
        gte(whatsappMessages.createdAt, from),
      ),
    );
  return row?.count ?? 0;
}

/** Vista segura de la configuración: sin secretos. */
export async function getWhatsappSettings(businessId: string) {
  const config = await ensureConfig(businessId);
  return {
    mode: config.mode === "cloud" ? ("cloud" as const) : ("basic" as const),
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
    hasAccessToken: Boolean(config.accessTokenEnc),
    hasAppSecret: Boolean(config.appSecretEnc),
    verifyToken: config.verifyToken,
    messagesEnabled: config.messagesEnabled,
    messageCap: config.messageCap,
    connectedAt: config.connectedAt,
    usedThisMonth: await countOutboundThisMonth(businessId),
  };
}

export type WhatsappSettings = Awaited<ReturnType<typeof getWhatsappSettings>>;

export async function updateWhatsappSettings(
  actor: Actor,
  input: {
    mode: "basic" | "cloud";
    phoneNumberId: string | null;
    wabaId: string | null;
    /** `undefined` conserva el secreto guardado; `null` lo borra. */
    accessToken?: string | null;
    appSecret?: string | null;
    messagesEnabled: boolean;
    messageCap: number;
  },
) {
  const current = await ensureConfig(actor.businessId);
  const accessTokenEnc =
    input.accessToken === undefined ? current.accessTokenEnc : input.accessToken ? encryptSecret(input.accessToken) : null;
  const appSecretEnc =
    input.appSecret === undefined ? current.appSecretEnc : input.appSecret ? encryptSecret(input.appSecret) : null;

  if (input.mode === "cloud" && (!input.phoneNumberId || !accessTokenEnc || !appSecretEnc)) {
    throw new WhatsappError(
      "INVALID",
      "Para usar la Cloud API escribe el ID del número, el token de acceso y el app secret.",
    );
  }

  await db
    .update(whatsappConfig)
    .set({
      mode: input.mode,
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      accessTokenEnc,
      appSecretEnc,
      verifyToken: current.verifyToken ?? randomToken(),
      messagesEnabled: input.mode === "cloud" && input.messagesEnabled,
      messageCap: input.messageCap,
      connectedAt: input.mode === "cloud" ? (current.connectedAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(whatsappConfig.businessId, actor.businessId));
}

export async function regenerateVerifyToken(actor: Actor) {
  await ensureConfig(actor.businessId);
  const token = randomToken();
  await db
    .update(whatsappConfig)
    .set({ verifyToken: token, updatedAt: new Date() })
    .where(eq(whatsappConfig.businessId, actor.businessId));
  return token;
}

/** Consulta el número en Meta para comprobar el token y el ID. */
export async function testWhatsappConnection(businessId: string, fetchImpl: Fetch = fetch) {
  const config = await ensureConfig(businessId);
  if (!config.phoneNumberId || !config.accessTokenEnc) {
    throw new WhatsappError("NOT_CONFIGURED", "Falta el ID del número o el token de acceso.");
  }
  const response = await fetchImpl(
    `${GRAPH}/${encodeURIComponent(config.phoneNumberId)}?fields=display_phone_number,verified_name`,
    {
      headers: { Authorization: `Bearer ${decryptSecret(config.accessTokenEnc)}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new WhatsappError("API_ERROR", `Meta respondió: ${body.error?.message ?? response.status}`);
  }
  return { phone: body.display_phone_number ?? "", name: body.verified_name ?? "" };
}

/* -------------------------------------------------------------------------- */
/* Webhook                                                                     */
/* -------------------------------------------------------------------------- */

/** Verifica X-Hub-Signature-256 (HMAC-SHA256 del cuerpo crudo con el app secret). */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = header.slice("sha256=".length);
  if (received.length !== expected.length || !/^[0-9a-f]+$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

/** Respuesta al GET de verificación de Meta. Devuelve el challenge o null. */
export async function verifyWebhookSubscription(
  businessId: string,
  params: { mode: string | null; token: string | null; challenge: string | null },
) {
  if (params.mode !== "subscribe" || !params.token || !params.challenge) return null;
  const [config] = await db
    .select({ verifyToken: whatsappConfig.verifyToken })
    .from(whatsappConfig)
    .where(eq(whatsappConfig.businessId, businessId))
    .limit(1);
  if (!config?.verifyToken) return null;
  const a = Buffer.from(config.verifyToken);
  const b = Buffer.from(params.token);
  return a.length === b.length && timingSafeEqual(a, b) ? params.challenge : null;
}

type WebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{ from?: string; id?: string; type?: string; timestamp?: string }>;
        statuses?: Array<{ id?: string; status?: string; errors?: Array<{ title?: string; code?: number }> }>;
      };
    }>;
  }>;
};

/**
 * Procesa un POST del webhook. Devuelve false si la firma no es válida.
 * Solo acepta eventos del número configurado para ese negocio.
 */
export async function handleWebhook(businessId: string, rawBody: string, signature: string | null) {
  const [config] = await db
    .select()
    .from(whatsappConfig)
    .where(eq(whatsappConfig.businessId, businessId))
    .limit(1);
  if (!config?.appSecretEnc || config.mode !== "cloud") return false;
  if (!verifySignature(rawBody, signature, decryptSecret(config.appSecretEnc))) return false;

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return true; // Firma válida pero cuerpo ilegible: se ignora sin reintentos.
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (change.field !== "messages" || !value) continue;
      if (value.metadata?.phone_number_id !== config.phoneNumberId) continue;

      for (const message of value.messages ?? []) {
        const digits = (message.from ?? "").replace(/\D/g, "");
        if (!digits || !message.id) continue;
        const sentAt = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();
        await db
          .insert(whatsappMessages)
          .values({
            businessId,
            direction: "inbound",
            phone: `+${digits}`,
            kind: message.type ?? "text",
            waMessageId: message.id,
            status: "received",
            createdAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
          })
          .onConflictDoNothing();
      }

      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;
        await db
          .update(whatsappMessages)
          .set({
            status: status.status,
            error: status.errors?.[0]?.title ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(whatsappMessages.businessId, businessId),
              eq(whatsappMessages.waMessageId, status.id),
              eq(whatsappMessages.direction, "outbound"),
            ),
          );
      }
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Envío                                                                       */
/* -------------------------------------------------------------------------- */

export async function lastInboundAt(businessId: string, phone: string) {
  const [row] = await db
    .select({ createdAt: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.businessId, businessId),
        eq(whatsappMessages.phone, phone),
        eq(whatsappMessages.direction, "inbound"),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/** ¿Se puede enviar por Cloud API a este teléfono ahora? (para mostrar el botón) */
export async function cloudSendStatus(businessId: string, phone: string | null, now = new Date()) {
  const [config] = await db
    .select({ mode: whatsappConfig.mode, enabled: whatsappConfig.messagesEnabled })
    .from(whatsappConfig)
    .where(eq(whatsappConfig.businessId, businessId))
    .limit(1);
  if (!config || config.mode !== "cloud" || !config.enabled || !phone) return { available: false as const };
  const last = await lastInboundAt(businessId, phone);
  const windowOpen = Boolean(last && now.getTime() - last.getTime() < SERVICE_WINDOW_MS);
  return { available: true as const, windowOpen };
}

export async function sendWhatsappText(
  actor: Actor,
  input: { phone: string | null; body: string; kind: "receipt" | "reminder" | "text" },
  options: { fetchImpl?: Fetch; now?: Date } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  if (!input.phone) throw new WhatsappError("NO_PHONE", "El cliente no tiene teléfono.");

  const [config] = await db
    .select()
    .from(whatsappConfig)
    .where(eq(whatsappConfig.businessId, actor.businessId))
    .limit(1);
  if (!config || config.mode !== "cloud" || !config.phoneNumberId || !config.accessTokenEnc) {
    throw new WhatsappError("NOT_CONFIGURED", "La Cloud API no está configurada. Usa el enlace de WhatsApp.");
  }
  if (!config.messagesEnabled) {
    throw new WhatsappError("DISABLED", "Los mensajes automáticos están desactivados en Ajustes.");
  }

  const last = await lastInboundAt(actor.businessId, input.phone);
  if (!last || now.getTime() - last.getTime() >= SERVICE_WINDOW_MS) {
    throw new WhatsappError(
      "OUTSIDE_WINDOW",
      "El cliente no te ha escrito en las últimas 24 horas. Usa el enlace de WhatsApp para enviarlo tú.",
    );
  }

  // Reservar el cupo es atómico: se bloquea la configuración, se cuenta y se
  // inserta el mensaje pendiente en la misma transacción. Dos envíos simultáneos
  // no pueden pasar ambos el tope.
  const from = await monthStart(actor.businessId, now);
  const record = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ cap: whatsappConfig.messageCap })
      .from(whatsappConfig)
      .where(eq(whatsappConfig.businessId, actor.businessId))
      .for("no key update");
    const [used] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.businessId, actor.businessId),
          eq(whatsappMessages.direction, "outbound"),
          ne(whatsappMessages.status, "failed"),
          gte(whatsappMessages.createdAt, from),
        ),
      );
    if ((used?.count ?? 0) >= (locked?.cap ?? 0)) {
      throw new WhatsappError("CAP_REACHED", "Llegaste al tope de mensajes de este mes. Usa el enlace de WhatsApp.");
    }
    const [row] = await tx
      .insert(whatsappMessages)
      .values({
        businessId: actor.businessId,
        direction: "outbound",
        phone: input.phone!,
        kind: input.kind,
        body: input.body,
        status: "pending",
      })
      .returning({ id: whatsappMessages.id });
    return row;
  });

  let waMessageId: string | null = null;
  let error: string | null = null;
  try {
    const response = await fetchImpl(`${GRAPH}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptSecret(config.accessTokenEnc)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.phone.replace(/\D/g, ""),
        type: "text",
        text: { preview_url: false, body: input.body.slice(0, 4096) },
      }),
      cache: "no-store",
      // Si Meta no responde, el mensaje queda como fallido y no cuenta para el tope.
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (response.ok) waMessageId = body.messages?.[0]?.id ?? null;
    else error = body.error?.message ?? `HTTP ${response.status}`;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Error de red";
  }

  await db
    .update(whatsappMessages)
    .set({ status: error ? "failed" : "sent", waMessageId, error, updatedAt: new Date() })
    .where(eq(whatsappMessages.id, record!.id));

  if (error) throw new WhatsappError("API_ERROR", `WhatsApp no aceptó el mensaje: ${error}`);
  return { waMessageId };
}

/* -------------------------------------------------------------------------- */
/* Catálogo                                                                    */
/* -------------------------------------------------------------------------- */

export async function updateCatalogSettings(
  actor: Actor,
  input: { slug: string | null; enabled: boolean },
) {
  if (input.enabled && !input.slug) {
    throw new WhatsappError("INVALID", "Escribe una dirección para publicar el catálogo.");
  }
  try {
    await db
      .update(businesses)
      .set({ slug: input.slug, catalogEnabled: input.enabled, updatedAt: new Date() })
      .where(eq(businesses.id, actor.businessId));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw new WhatsappError("INVALID", "Esa dirección ya la usa otro negocio. Prueba otra.");
    throw error;
  }
}
