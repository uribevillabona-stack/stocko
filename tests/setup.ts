import { config } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";

config({ path: ".env.local" });

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

if (!testDatabaseUrl) {
  throw new Error(
    "Falta DATABASE_URL_TEST. Añádela a .env.local apuntando a una base de datos de prueba.",
  );
}

// Force use of test DB URL before any db import happens
process.env.DATABASE_URL = testDatabaseUrl;

// Reset pool if previously created with different URL
const globalForDb = globalThis as typeof globalThis & { pool?: { end: () => Promise<void> } };
if (globalForDb.pool) {
  try {
    await globalForDb.pool.end();
  } catch {
    // El pool anterior ya estaba cerrado.
  }
  delete globalForDb.pool;
}

// Now import db - it will create a fresh pool with the test URL
const { db } = await import("@/lib/db/client");

const state = globalThis as typeof globalThis & { __stockoTestMigrated?: boolean };

if (!state.__stockoTestMigrated) {
  await migrate(db, { migrationsFolder: "drizzle" });
  state.__stockoTestMigrated = true;
}