import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    // 0 = nunca cerrar conexiones inactivas (versión de escritorio: abrir una
    // conexión en Windows cuesta ~0,5 s y solo hay un usuario).
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS ?? 30_000,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

export const db = drizzle(pool, { schema });

export type DbClient = typeof db;
export type Transaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
