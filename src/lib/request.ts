import { headers } from "next/headers";

/**
 * Encabezado del que se toma la IP del cliente. Solo es confiable el que pone
 * tu plataforma: en Netlify, `x-nf-client-connection-ip`; detrás de tu propio
 * proxy, el que él escriba (p. ej. `x-forwarded-for`). Configúralo con
 * TRUSTED_IP_HEADER; si no, se usa la lista por defecto.
 */
export const IP_HEADERS = process.env.TRUSTED_IP_HEADER
  ? [process.env.TRUSTED_IP_HEADER.toLowerCase()]
  : ["x-nf-client-connection-ip", "x-forwarded-for", "x-real-ip"];

export async function clientIp(): Promise<string> {
  const list = await headers();
  for (const name of IP_HEADERS) {
    const value = list.get(name)?.split(",")[0]?.trim();
    if (value) return value.slice(0, 64);
  }
  return "desconocida";
}
