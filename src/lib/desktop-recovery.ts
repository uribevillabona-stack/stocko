import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Recuperar la contraseña en Stocko para Windows. Stocko firma el token con una clave
 * de ese arranque (STOCKO_RECOVERY_KEY); aquí solo se verifica.
 * Mismo formato que desktop/lib/recovery.cjs: `<vence (ms)>.<nonce>.<firma>`.
 */
export const RECOVERY_ACTION_URL = "https://accion.stocko.invalid/recuperar-contrasena";
const PURPOSE = "stocko-desktop-recovery";
/** Un token nunca vale más que esto, aunque diga otra cosa (lo emite Stocko con 15 min). */
const MAX_TTL_MS = 15 * 60 * 1000;

export type RecoveryToken = { nonce: string; expiresAt: Date };

export function verifyRecoveryToken(
  token: string | undefined,
  key: string | undefined,
  now = Date.now(),
): RecoveryToken | null {
  if (!token || !key) return null;
  const [expires, nonce, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !expires || !nonce || !signature) return null;
  if (!/^\d{1,15}$/.test(expires) || !/^[\w-]{16,64}$/.test(nonce)) return null;

  const expected = createHmac("sha256", key).update(`${PURPOSE}\0${expires}.${nonce}`).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const expiresAt = Number(expires);
  if (expiresAt <= now || expiresAt - now > MAX_TTL_MS) return null;
  return { nonce, expiresAt: new Date(expiresAt) };
}
