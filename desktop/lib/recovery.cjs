"use strict";
// Recuperar la contraseña en Stocko para Windows (ahí no hay correo para enviar un enlace).
//
// Stocko (este proceso) abre /recuperar?token=… en su propia ventana. El token lo firma
// una clave que se crea en cada arranque y solo conocen este proceso y el servidor
// (variable STOCKO_RECOVERY_KEY): nadie más en el PC ni en la red puede crear uno.
// El servidor lo verifica en src/lib/desktop-recovery.ts — el formato debe ser el mismo.
//
// Quien usa este PC con esta cuenta de Windows ya puede abrir la base de datos; esto no
// abre una puerta nueva, solo la hace usable. Queda registrado en Actividad.
const crypto = require("node:crypto");

/** La página que lo pide (enlace "¿Olvidaste tu contraseña?" en /login). */
const RECOVERY_ACTION_URL = "https://accion.stocko.invalid/recuperar-contrasena";
const RECOVERY_TTL_MS = 15 * 60 * 1000;
const PURPOSE = "stocko-desktop-recovery";

function newRecoveryKey() {
  return crypto.randomBytes(32).toString("base64url");
}

function sign(key, payload) {
  return crypto.createHmac("sha256", key).update(`${PURPOSE}\0${payload}`).digest("base64url");
}

/** `<vence (ms)>.<nonce>.<firma>` — un solo uso (el servidor guarda el nonce al usarlo). */
function createRecoveryToken(key, now = Date.now()) {
  const payload = `${now + RECOVERY_TTL_MS}.${crypto.randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(key, payload)}`;
}

module.exports = { RECOVERY_ACTION_URL, RECOVERY_TTL_MS, newRecoveryKey, createRecoveryToken };
