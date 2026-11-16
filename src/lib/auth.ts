import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db/client";
import { account, rateLimit, session, user, verification } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { IP_HEADERS } from "@/lib/request";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification, rateLimit },
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  // Stocko entra, registra y cambia contraseñas con server actions (que aplican
  // sus propios límites por correo e IP). Esos endpoints HTTP no se usan y se
  // cierran para que nadie esquive esos límites llamándolos directamente.
  disabledPaths: ["/sign-in/email", "/sign-up/email", "/change-password", "/update-user", "/change-email"],
  // Límite de intentos en el resto de /api/auth (compartido entre instancias
  // serverless gracias a la base de datos).
  rateLimit: {
    enabled: env.NODE_ENV !== "test",
    storage: "database",
    window: 60,
    max: 100,
  },
  advanced: {
    ipAddress: { ipAddressHeaders: IP_HEADERS },
  },
  plugins: [nextCookies()],
});
