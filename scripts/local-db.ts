import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(process.cwd(), ".local", "pg");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "stocko",
  password: "stocko",
  port: 5433,
  persistent: true,
});

if (!existsSync(join(dataDir, "PG_VERSION"))) {
  console.log("Inicializando el cluster de Postgres local...");
  await pg.initialise();
}

await pg.start();

for (const name of ["stocko", "stocko_test"]) {
  try {
    await pg.createDatabase(name);
    console.log(`Base "${name}" creada.`);
  } catch {
    console.log(`Base "${name}" ya existe.`);
  }
}

console.log("");
console.log("Postgres local en postgres://stocko:stocko@localhost:5433");
console.log("Deja esta terminal abierta. Ctrl+C para detener.");
console.log("");

const shutdown = async () => {
  console.log("Deteniendo Postgres local...");
  await pg.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise(() => {});
