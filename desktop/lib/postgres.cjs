"use strict";
// Postgres propio de la versión de escritorio: un cluster en la carpeta de datos
// del usuario, que solo escucha en 127.0.0.1 y se maneja con pg_ctl.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const DB_USER = "stocko";

function bin(pgDir, name) {
  return path.join(pgDir, "bin", `${name}.exe`);
}

/**
 * Ejecuta un binario y espera a que termine. Se usa "exit" y no "close": el
 * postgres que deja corriendo `pg_ctl start` puede heredar las tuberías y
 * mantenerlas abiertas para siempre.
 */
function run(file, args, { capture = true, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
      env: { ...process.env, LC_MESSAGES: "C" },
    });
    if (capture) {
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${output}${String(error)}` });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

function isInitialised(dataDir) {
  return fs.existsSync(path.join(dataDir, "PG_VERSION"));
}

/**
 * Crea el cluster en una carpeta temporal y solo la renombra a `dataDir` si
 * initdb terminó bien: un primer arranque interrumpido nunca deja un pgdata a
 * medias, y nunca se borra un pgdata que ya existía.
 */
async function initCluster({ pgDir, dataDir, password, log }) {
  if (fs.existsSync(dataDir)) {
    throw new Error(`La carpeta ${dataDir} existe pero no es una base de datos válida. Muévela o restaura una copia.`);
  }
  const temp = `${dataDir}.nuevo`;
  const passwordFile = path.join(path.dirname(dataDir), `.pw-${process.pid}.tmp`);
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  fs.writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
  try {
    const result = await run(bin(pgDir, "initdb"), [
      `--pgdata=${temp}`,
      `--username=${DB_USER}`,
      "--auth=scram-sha-256",
      `--pwfile=${passwordFile}`,
      "--encoding=UTF8",
      "--locale=C",
      // Proveedor "builtin": lower()/upper() correctos con tildes y ñ, igual en
      // cualquier Windows (los nombres de locale del sistema varían por idioma).
      "--locale-provider=builtin",
      "--builtin-locale=C.UTF-8",
    ]);
    log(`initdb → ${result.code}\n${result.output}`);
    if (result.code !== 0) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw new Error(`No se pudo crear la base de datos (initdb ${result.code}).`);
    }
    await renameWithRetry(temp, dataDir);
  } finally {
    fs.rmSync(passwordFile, { force: true });
  }
}

/** Restos de un primer arranque interrumpido (cluster a medias, archivo de contraseña). */
function cleanupStale(dataRoot) {
  if (!fs.existsSync(dataRoot)) return;
  for (const name of fs.readdirSync(dataRoot)) {
    if (STALE_PASSWORD_FILE.test(name) || name === "pgdata.nuevo") {
      fs.rmSync(path.join(dataRoot, name), { recursive: true, force: true });
    }
  }
}

const STALE_PASSWORD_FILE = /^\.pw-\d+\.tmp$/;

/** "pg_ctl (PostgreSQL) 18.4" → 18 */
function parseMajor(versionOutput) {
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(versionOutput);
  return match ? Number(match[1]) : null;
}

let bundledMajorCache = null;
/** Versión mayor de los binarios incluidos (p. ej. 18). */
async function bundledMajor(pgDir) {
  if (bundledMajorCache) return bundledMajorCache;
  const result = await run(bin(pgDir, "pg_ctl"), ["--version"]);
  bundledMajorCache = parseMajor(result.output);
  return bundledMajorCache;
}

/**
 * Renombra una carpeta reintentando: en Windows el antivirus o el indexador
 * pueden tener abiertos por un momento archivos recién escritos (EPERM/EBUSY).
 */
async function renameWithRetry(from, to, attempts = 15) {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (i >= attempts || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * i));
    }
  }
}

function clusterMajor(dataDir) {
  try {
    return Number.parseInt(fs.readFileSync(path.join(dataDir, "PG_VERSION"), "utf8").trim(), 10);
  } catch {
    return null;
  }
}

async function isRunning({ pgDir, dataDir }) {
  if (!isInitialised(dataDir)) return false;
  const result = await run(bin(pgDir, "pg_ctl"), ["status", `--pgdata=${dataDir}`]);
  return result.code === 0;
}

async function start({ pgDir, dataDir, port, logFile, log }) {
  const expected = await bundledMajor(pgDir);
  const actual = clusterMajor(dataDir);
  if (expected && actual && expected !== actual) {
    throw new Error(`La base de datos es de la versión ${actual} de PostgreSQL y este Stocko trae la ${expected}. Instala la versión de Stocko con la que se creó o restaura una copia compatible.`);
  }
  // Si quedó un postgres de una sesión que se cerró mal, se detiene primero.
  if (await isRunning({ pgDir, dataDir })) await stop({ pgDir, dataDir, log });
  const result = await run(
    bin(pgDir, "pg_ctl"),
    [
      "start",
      `--pgdata=${dataDir}`,
      `--log=${logFile}`,
      "--wait",
      "--timeout=90",
      `--options=-p ${port} -c listen_addresses=127.0.0.1`,
    ],
    { capture: false, timeoutMs: 120_000 },
  );
  log(`pg_ctl start (puerto ${port}) → ${result.code}`);
  if (result.code !== 0) {
    throw new Error(`La base de datos no arrancó (pg_ctl ${result.code}). Revisa ${logFile}.`);
  }
}

async function stop({ pgDir, dataDir, log }) {
  if (!isInitialised(dataDir)) return;
  const ctl = bin(pgDir, "pg_ctl");
  let result = await run(ctl, ["stop", `--pgdata=${dataDir}`, "--mode=fast", "--wait", "--timeout=60"]);
  if (result.code !== 0 && (await isRunning({ pgDir, dataDir }))) {
    result = await run(ctl, ["stop", `--pgdata=${dataDir}`, "--mode=immediate", "--wait", "--timeout=30"]);
  }
  log(`pg_ctl stop → ${result.code}`);
}

/** Parada rápida y síncrona para cuando Windows cierra la sesión. */
function stopSync({ pgDir, dataDir }) {
  if (!isInitialised(dataDir)) return;
  spawnSync(bin(pgDir, "pg_ctl"), ["stop", `--pgdata=${dataDir}`, "--mode=fast", "--wait", "--timeout=15"], {
    windowsHide: true,
    stdio: "ignore",
  });
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      const { port: chosen } = probe.address();
      probe.close(() => resolve(chosen));
    });
  });
}

/** Devuelve `preferred` si está libre; si no, cualquier puerto libre. */
async function freePort(preferred) {
  if (preferred) {
    try {
      return await listen(preferred);
    } catch {
      // ocupado
    }
  }
  return listen(0);
}

module.exports = { DB_USER, bundledMajor, cleanupStale, freePort, initCluster, isInitialised, isRunning, parseMajor, renameWithRetry, start, stop, stopSync };
