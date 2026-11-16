import { z } from "zod";
import { handleWebhook, verifyWebhookSubscription } from "@/server/services/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Webhook de la WhatsApp Cloud API para un negocio.
 * URL que se configura en Meta: /api/whatsapp/webhook/<id del negocio>
 */
export async function GET(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  if (!z.uuid().safeParse(businessId).success) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const challenge = await verifyWebhookSubscription(businessId, {
    mode: url.searchParams.get("hub.mode"),
    token: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge"),
  });

  return challenge
    ? new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } })
    : new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  if (!z.uuid().safeParse(businessId).success) return new Response("Not found", { status: 404 });

  // Rechazos baratos antes de leer el cuerpo o tocar la base de datos.
  const signature = request.headers.get("x-hub-signature-256");
  if (!signature?.startsWith("sha256=")) return new Response("Forbidden", { status: 403 });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > 1_000_000) return new Response("Payload too large", { status: 413 });

  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return new Response("Payload too large", { status: 413 });

  try {
    const ok = await handleWebhook(businessId, rawBody, signature);
    return new Response(ok ? "OK" : "Forbidden", { status: ok ? 200 : 403 });
  } catch (error) {
    console.error("Webhook de WhatsApp", error instanceof Error ? error.message : "desconocido");
    return new Response("Error", { status: 500 });
  }
}
