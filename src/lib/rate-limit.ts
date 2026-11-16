import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rateLimit } from "@/lib/db/schema";

/**
 * Límite de intentos por clave con ventana fija, atómico en Postgres (sirve
 * con varias instancias serverless). En estas claves `last_request` guarda el
 * inicio de la ventana: seguir intentando no la alarga, así que nadie puede
 * dejar una cuenta bloqueada para siempre con pocos intentos.
 */
type Limit = { max: number; windowMs: number; now?: number };

export async function hitRateLimit(
  key: string,
  options: Limit,
): Promise<{ allowed: boolean; count: number }> {
  const now = options.now ?? Date.now();
  const result = await db.execute<{ count: number }>(sql`
    insert into rate_limit (id, key, count, last_request)
    values (${randomUUID()}, ${key}, 1, ${now})
    on conflict (key) do update set
      count = case
        when ${now}::bigint - rate_limit.last_request >= ${options.windowMs}::bigint then 1
        else rate_limit.count + 1
      end,
      last_request = case
        when ${now}::bigint - rate_limit.last_request >= ${options.windowMs}::bigint then ${now}::bigint
        else rate_limit.last_request
      end
    returning count
  `);
  const count = Number(result.rows[0]?.count ?? 1);
  return { allowed: count <= options.max, count };
}

/** ¿La clave ya agotó sus intentos en la ventana actual? No suma. */
export async function isRateLimited(key: string, options: Limit): Promise<boolean> {
  const now = options.now ?? Date.now();
  const [row] = await db
    .select({ count: rateLimit.count, start: rateLimit.lastRequest })
    .from(rateLimit)
    .where(eq(rateLimit.key, key))
    .limit(1);
  return Boolean(row && now - row.start < options.windowMs && row.count >= options.max);
}

export async function clearRateLimit(...keys: string[]) {
  for (const key of keys) {
    await db.delete(rateLimit).where(and(eq(rateLimit.key, key)));
  }
}

export const RATE_LIMITS = {
  /** Fallos por correo desde una misma IP: frena la fuerza bruta. */
  loginFailuresPerEmailIp: { max: 8, windowMs: 15 * 60 * 1000 },
  /** Fallos por correo desde cualquier IP: tope alto para que bloquear a otro sea caro. */
  loginFailuresPerEmail: { max: 50, windowMs: 60 * 60 * 1000 },
  /** Intentos por IP, exitosos o no: frena barridos de muchos correos. */
  loginPerIp: { max: 30, windowMs: 15 * 60 * 1000 },
  registerPerIp: { max: 10, windowMs: 60 * 60 * 1000 },
  invitationPerIp: { max: 20, windowMs: 60 * 60 * 1000 },
  /** Cuentas de trabajadores creadas por un dueño (cada una calcula un hash costoso). */
  employeePerUser: { max: 20, windowMs: 60 * 60 * 1000 },
  passwordPerUser: { max: 10, windowMs: 60 * 60 * 1000 },
} as const;

export const RATE_LIMIT_MESSAGE = "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
