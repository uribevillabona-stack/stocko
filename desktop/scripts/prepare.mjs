// Prepara los archivos que lleva el instalador de escritorio:
//   server/  → Next standalone + estáticos + public
//   pgsql/   → binarios de Postgres para Windows
//   drizzle/ → migraciones
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { stageDir } = require("../paths.cjs");

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(desktopDir, "..");
const dist = join(root, ".next-desktop");

console.log("1/4 Compilando Stocko para escritorio…");
// OneDrive puede tener abierto algún archivo del build anterior: se reintenta.
rmSync(dist, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
execSync("npx next build", {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    STOCKO_DESKTOP: "1",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    // Siempre http local: sin HSTS ni upgrade-insecure-requests en la CSP.
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1",
    BETTER_AUTH_URL: "http://127.0.0.1",
  },
});

console.log(`2/4 Copiando el servidor a ${stageDir}…`);
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
const serverOut = join(stageDir, "server");
cpSync(join(dist, "standalone"), serverOut, { recursive: true, dereference: true });
cpSync(join(dist, "static"), join(serverOut, ".next-desktop", "static"), { recursive: true });
cpSync(join(root, "public"), join(serverOut, "public"), { recursive: true });
cpSync(join(desktopDir, "server-entry.mjs"), join(serverOut, "stocko-entry.mjs"));

// El rastreo de Next copia el .node de sharp pero no las DLL de libvips que
// carga a su lado: se copian los paquetes nativos completos.
const imgDir = join(root, "node_modules", "@img");
for (const name of readdirSync(imgDir)) {
  cpSync(join(imgDir, name), join(serverOut, "node_modules", "@img", name), { recursive: true, dereference: true });
}
if (!existsSync(join(serverOut, "node_modules", "@img", "sharp-win32-x64", "lib", "libvips-42.dll"))) {
  throw new Error("Falta libvips-42.dll de sharp en el servidor de escritorio");
}

// Sin mapas de fuente (código del proyecto) ni archivos .env en el instalador.
function prune(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) prune(full);
    else if (name.endsWith(".map")) rmSync(full);
  }
}
prune(join(serverOut, ".next-desktop"));
for (const name of readdirSync(serverOut)) {
  if (name.startsWith(".env")) throw new Error(`No debe ir ${name} en el instalador`);
}

console.log("3/4 Copiando Postgres…");
const pgNative = join(root, "node_modules", "@embedded-postgres", "windows-x64", "native");
if (!existsSync(join(pgNative, "bin", "pg_ctl.exe"))) {
  throw new Error("No están los binarios de Postgres. Ejecuta npm install en la raíz del proyecto.");
}
cpSync(pgNative, join(stageDir, "pgsql"), { recursive: true, dereference: true });
// Postgres e ICU usan el runtime de Visual C++ 2015-2022, que un Windows recién
// instalado puede no tener. Se incluye junto a los binarios (despliegue local
// permitido por la licencia de los redistribuibles de Microsoft).
const system32 = join(process.env.SystemRoot || "C:\\Windows", "System32");
for (const dll of ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"]) {
  const from = join(system32, dll);
  if (!existsSync(from)) {
    throw new Error(`Falta ${dll} en ${system32}. Instala "Microsoft Visual C++ Redistributable 2015-2022 x64" y repite.`);
  }
  cpSync(from, join(stageDir, "pgsql", "bin", dll));
}

// La app compara esta versión con la de cada base y cada copia: debe poder leerse.
const versionOut = execSync(`"${join(stageDir, "pgsql", "bin", "pg_ctl.exe")}" --version`, { encoding: "utf8" });
if (!/\(PostgreSQL\)\s+\d+/.test(versionOut)) throw new Error(`No se pudo leer la versión de Postgres: ${versionOut}`);

// Ícono de Stocko para los accesos directos (Stocko.exe es el electron.exe original
// sin modificar, ver electron-builder.config.cjs): ICO con una imagen PNG de 256 px.
const sharp = require(join(root, "node_modules", "sharp"));
const png = await sharp(join(root, "public", "icons", "icon-512.png")).resize(256, 256).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); // reservado
ico.writeUInt16LE(1, 2); // tipo: ícono
ico.writeUInt16LE(1, 4); // una imagen
ico.writeUInt8(0, 6); // ancho 256
ico.writeUInt8(0, 7); // alto 256
ico.writeUInt16LE(1, 10); // planos
ico.writeUInt16LE(32, 12); // bits por píxel
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18); // la imagen empieza después de la cabecera
writeFileSync(join(stageDir, "stocko.ico"), Buffer.concat([ico, png]));

console.log("4/4 Copiando migraciones…");
cpSync(join(root, "drizzle"), join(stageDir, "drizzle"), { recursive: true });

console.log(`Listo: ${stageDir}`);
