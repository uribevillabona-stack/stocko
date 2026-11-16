import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET debe tener al menos 32 caracteres"),
  BETTER_AUTH_URL: z.url("BETTER_AUTH_URL debe ser una URL válida"),
  NEXT_PUBLIC_APP_URL: z.url("NEXT_PUBLIC_APP_URL debe ser una URL válida"),
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY es obligatoria")
    .refine(
      (value) => Buffer.from(value, "base64").length === 32,
      "ENCRYPTION_KEY debe ser de 32 bytes codificados en base64",
    ),
  // Milisegundos antes de cerrar una conexión inactiva a la base (0 = nunca).
  DB_IDLE_TIMEOUT_MS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).optional(),
  ),
  // "1" cuando corre dentro de Stocko para Windows (sin internet, un solo PC).
  STOCKO_DESKTOP: z.preprocess((value) => (value === "" ? undefined : value), z.literal("1").optional()),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Fotos de producto (opcional). Neon Object Storage es compatible con S3.
  NEON_STORAGE_ENDPOINT: z.string().optional(),
  NEON_STORAGE_REGION: z.string().optional(),
  NEON_STORAGE_BUCKET: z.string().optional(),
  NEON_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  NEON_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  // Fotos en una carpeta local en vez de S3 (desarrollo o servidor propio; no en Netlify).
  LOCAL_UPLOADS_DIR: z.string().optional(),
});

const parsed = envSchema
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") return;
    // En producción real (https) los secretos no pueden ser los de ejemplo.
    if (value.BETTER_AUTH_SECRET.startsWith("cambia-esto")) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "Usa un secreto aleatorio en producción" });
    }
    if (value.BETTER_AUTH_URL !== value.NEXT_PUBLIC_APP_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_APP_URL"],
        message: "BETTER_AUTH_URL y NEXT_PUBLIC_APP_URL deben ser el mismo dominio",
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error("Variables de entorno inválidas:");
  console.error(z.treeifyError(parsed.error));
  throw new Error("Revisa tu archivo .env.local. Hay un .env.example como referencia.");
}

export const env = parsed.data;
