"use strict";
// Stocko para Windows. Todo corre en este PC, sin internet:
//   1. Postgres propio en %LOCALAPPDATA%\Stocko\pgdata (solo 127.0.0.1).
//   2. Migraciones de la base al abrir (también al actualizar Stocko).
//   3. El servidor de Next (versión standalone) en 127.0.0.1.
//   4. Una ventana que lo muestra.
// Lo único que pide por internet por su cuenta es buscar actualizaciones (lib/updates.cjs).
// Arrancar, copiar, restaurar, reiniciar y cerrar van de a uno (`serial`), y
// los datos nunca se tocan con Postgres corriendo.
const { app, BrowserWindow, Menu, dialog, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pgctl = require("./lib/postgres.cjs");
const backup = require("./lib/backup.cjs");
const updates = require("./lib/updates.cjs");

const PREFERRED_APP_PORT = 47821;
const DB_NAME = "stocko";

const resourcesRoot = app.isPackaged ? process.resourcesPath : require("./paths.cjs").stageDir;
const pgDir = path.join(resourcesRoot, "pgsql");
const serverDir = path.join(resourcesRoot, "server");
const migrationsDir = path.join(resourcesRoot, "drizzle");

// Datos en AppData\Local (no Roaming: un cluster de Postgres no debe viajar con
// perfiles móviles de dominio). STOCKO_DATA_DIR: otra carpeta (pruebas).
// Paquete MSIX (Microsoft Store): Electron lo marca en process.windowsStore.
const IS_STORE = process.windowsStore === true;
const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");

/**
 * Nombre de familia del paquete (Nombre_IdDelEditor), calculado desde su manifiesto.
 * El id del editor es el SHA-256 del editor (UTF-16LE), 8 bytes, en base32 de Crockford.
 */
function storePackageFamilyName() {
  try {
    const manifest = fs.readFileSync(path.join(path.dirname(process.execPath), "..", "AppxManifest.xml"), "utf8");
    const identity = /<Identity\b[^>]*>/.exec(manifest)?.[0] ?? "";
    const decode = (value) =>
      value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const name = /\sName="([^"]+)"/.exec(identity)?.[1];
    const publisher = /\sPublisher="([^"]+)"/.exec(identity)?.[1];
    if (!name || !publisher) return null;
    const digest = crypto.createHash("sha256").update(Buffer.from(decode(publisher), "utf16le")).digest().subarray(0, 8);
    let bits = "";
    for (const byte of digest) bits += byte.toString(2).padStart(8, "0");
    bits += "0";
    const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
    let id = "";
    for (let i = 0; i < 65; i += 5) id += alphabet[Number.parseInt(bits.slice(i, i + 5), 2)];
    return `${decode(name)}_${id}`;
  } catch {
    return null;
  }
}

/**
 * Carpeta de datos.
 * - .exe / portable: %LOCALAPPDATA%\Stocko.
 * - Store: la carpeta REAL del paquete (Packages\<familia>\LocalState). La ruta
 *   virtualizada de AppData no sirve: Postgres arranca sus procesos con permisos
 *   reducidos, fuera de la virtualización del paquete, y no la vería. Windows
 *   también borra esta carpeta al desinstalar (por eso las copias van a Documentos).
 */
let storeSetupError = null;
function defaultDataRoot() {
  if (IS_STORE) {
    const family = storePackageFamilyName();
    const packageDir = family ? path.join(localAppData, "Packages", family) : null;
    // Windows crea Packages\<familia> al instalar: si no está, la familia calculada no es la real.
    if (packageDir && fs.existsSync(packageDir)) return path.join(packageDir, "LocalState", "Stocko");
    // No se cae a %LOCALAPPDATA%\Stocko: dentro del paquete esa ruta está virtualizada
    // (Postgres no la ve) y podría mezclarse con una instalación .exe de este PC.
    storeSetupError = new Error(
      "No se encontró la carpeta de datos de esta instalación de Stocko (Microsoft Store). " +
        "Desinstala Stocko y vuelve a instalarlo desde la Store.",
    );
  }
  return path.join(localAppData, "Stocko");
}

const dataRoot = path.resolve(process.env.STOCKO_DATA_DIR || defaultDataRoot());
app.setPath("userData", dataRoot);
const startupNotes = [];

/**
 * Versión de la Microsoft Store: Windows borra los datos de la app al desinstalarla,
 * así que las copias automáticas van a Documentos, que se conserva. Una subcarpeta
 * por PC: con OneDrive, Documentos se sincroniza entre equipos y las copias de uno
 * no deben borrar, reemplazar ni bloquear las del otro.
 */
function backupsDir() {
  if (!IS_STORE) return path.join(dataRoot, "copias");
  let pc = (os.hostname() || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").trim() || "este-pc";
  // Nombres reservados de Windows (CON, NUL, COM1…) no sirven como carpeta.
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(pc)) pc = `pc-${pc}`;
  try {
    return path.join(app.getPath("documents"), "Stocko", "Copias", pc);
  } catch (error) {
    startupNotes.push(`sin carpeta Documentos (${error}); copias en la carpeta de datos`);
    return path.join(dataRoot, "copias");
  }
}

const paths = {
  pgData: path.join(dataRoot, "pgdata"),
  config: path.join(dataRoot, "config.json"),
  state: path.join(dataRoot, "estado.json"),
  uploads: path.join(dataRoot, "fotos"),
  backups: backupsDir(),
  logs: path.join(dataRoot, "logs"),
};
// Los datos que aparta una restauración se mueven con renombres, así que deben
// quedar en el mismo disco que los datos (Documentos puede estar en otro disco o
// en OneDrive). En la Store se copian a Documentos cuando la restauración termina bien.
paths.safety = IS_STORE ? path.join(dataRoot, "copias-locales") : paths.backups;
// Store: Copias\ (con una carpeta por PC). Si no, la misma carpeta de copias.
paths.backupsRoot = IS_STORE && path.basename(path.dirname(paths.backups)) === "Copias" ? path.dirname(paths.backups) : paths.backups;

/** ¿Hay copias de antes? En la Store también las de otros PC (Documentos sincronizado por OneDrive). */
function hasPreviousBackups() {
  if (backup.hasAnyBackup(paths.backups)) return true;
  if (paths.backupsRoot === paths.backups) return false;
  let names;
  try {
    names = fs.readdirSync(paths.backupsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new Error(`No se pudo revisar la carpeta de copias (${paths.backupsRoot}): ${error.message}`);
  }
  return names.some((entry) => entry.isDirectory() && backup.hasAnyBackup(path.join(paths.backupsRoot, entry.name)));
}

/** "starting" | "ready" | "busy" | "failed" */
let state = "starting";
let mainWindow = null;
let server = null;
let appUrl = null;
let quitting = false;
let shutdownDone = false;
/** Actualizaciones (instalador y portable; en la Store y en desarrollo queda inactivo). */
let updater = null;

app.commandLine.appendSwitch("lang", "es");
// Mismo ID que los accesos directos (appId): la barra de tareas agrupa la ventana
// con ellos y muestra el ícono de Stocko (Stocko.exe no lleva ícono propio).
// En la Store la identidad la da el paquete (nombre e ícono incluidos): no se cambia.
if (!IS_STORE) app.setAppUserModelId("co.stocko.desktop");
const shortcutIcon = app.isPackaged ? path.join(process.resourcesPath, "stocko.ico") : process.execPath;

class Aborted extends Error {}

/** No hay base de datos pero esta instalación ya tuvo una (o hay copias): se puede restaurar o empezar de cero. */
class MissingDatabaseError extends Error {
  constructor(message) {
    super(message);
    this.code = "MISSING_DB";
  }
}
let lastFailure = null;
function checkpoint() {
  if (quitting) throw new Aborted("Stocko se está cerrando");
}

// ------------------------------------------------------------ una a la vez

let chain = Promise.resolve();
function serial(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------- registro

function log(message) {
  try {
    fs.mkdirSync(paths.logs, { recursive: true });
    fs.appendFileSync(path.join(paths.logs, "stocko.log"), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // sin registro no se detiene la app
  }
}

function rotateLogs() {
  fs.mkdirSync(paths.logs, { recursive: true });
  for (const name of ["stocko.log", "servidor.log", "postgres.log"]) {
    const file = path.join(paths.logs, name);
    try {
      if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, `${file}.anterior`);
    } catch {
      // no existe todavía
    }
  }
}

// ----------------------------------------------------------- configuración

function writeJson(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

/** Claves propias de esta instalación, generadas la primera vez. */
function loadConfig() {
  if (fs.existsSync(paths.config)) return JSON.parse(fs.readFileSync(paths.config, "utf8"));
  if (pgctl.isInitialised(paths.pgData)) {
    throw new Error(
      "Falta el archivo config.json de Stocko y sin él no se puede abrir la base de datos. " +
        "Restaura una copia de seguridad (menú Archivo → Restaurar una copia).",
    );
  }
  const config = {
    version: 1,
    dbPassword: crypto.randomBytes(24).toString("base64url"),
    authSecret: crypto.randomBytes(48).toString("base64url"),
    encryptionKey: crypto.randomBytes(32).toString("base64"),
    appPort: PREFERRED_APP_PORT,
    initialisedAt: null,
  };
  fs.mkdirSync(dataRoot, { recursive: true });
  writeJson(paths.config, config);
  return config;
}

/** Estado de la última sesión (no va en las copias). */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(paths.state, "utf8"));
  } catch {
    return {};
  }
}

function updateState(patch) {
  fs.mkdirSync(dataRoot, { recursive: true });
  writeJson(paths.state, { ...readState(), ...patch });
}

// ---------------------------------------------------------------- servicios

async function ensureDatabase(config, pgPort) {
  const { Client } = require("pg");
  const client = new Client({
    host: "127.0.0.1",
    port: pgPort,
    user: pgctl.DB_USER,
    password: config.dbPassword,
    database: "postgres",
  });
  await client.connect();
  try {
    const found = await client.query("select 1 from pg_database where datname = $1", [DB_NAME]);
    if (found.rowCount === 0) await client.query(`create database ${DB_NAME}`);
  } finally {
    await client.end();
  }
}

async function runMigrations(databaseUrl) {
  const { Pool } = require("pg");
  const { drizzle } = require("drizzle-orm/node-postgres");
  const { migrate } = require("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationsDir });
  } finally {
    await pool.end();
  }
}

/** Solo las variables que el servidor necesita (nada del entorno del usuario). */
function serverEnv(extra) {
  const keep = ["SystemRoot", "windir", "ComSpec", "PATH", "Path", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"];
  const env = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, ...extra };
}

async function waitForServer(child, url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.spawnError) throw new Error(`No se pudo iniciar el servidor: ${child.spawnError.message}`);
    if (child.exitCode !== null) throw new Error(`El servidor se cerró al arrancar (código ${child.exitCode}).`);
    checkpoint();
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch {
      // todavía arrancando
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("El servidor tardó demasiado en arrancar.");
}

async function startServices(status, { fresh = false } = {}) {
  if (storeSetupError) throw storeSetupError;
  if (!fs.existsSync(path.join(serverDir, "stocko-entry.mjs")) || !fs.existsSync(pgDir)) {
    throw new Error(`Faltan archivos de Stocko en ${resourcesRoot}. Reinstala el programa.`);
  }
  // Nunca se abre la base con una restauración a medias (también al "Reintentar abrir").
  backup.recoverPendingRestore(dataRoot, log);
  const config = loadConfig();

  if (pgctl.isInitialised(paths.pgData) && !config.initialisedAt) {
    // Instalaciones anteriores a esta marca: se anota que ya hay una base.
    writeJson(paths.config, { ...config, initialisedAt: new Date().toISOString() });
  }
  if (!pgctl.isInitialised(paths.pgData)) {
    // Si esta instalación ya tuvo una base (o hay copias), no se crea una vacía en silencio.
    if (!fresh && (config.initialisedAt || hasPreviousBackups())) {
      throw new MissingDatabaseError(
        config.initialisedAt
          ? `No se encuentra la base de datos de Stocko (falta la carpeta pgdata en ${dataRoot}).`
          : "Hay copias de seguridad de Stocko de antes, pero esta instalación todavía no tiene datos.",
      );
    }
    if (fresh) {
      // Las copias de los datos anteriores se apartan: las de la base nueva no las reemplazan ni las borran.
      const kept = backup.setAsideBackups(paths.backups, `antes-de-empezar-${backup.stamp()}`);
      if (kept) log(`copias anteriores apartadas en ${kept}`);
      if (fs.existsSync(paths.uploads)) {
        // Fotos de la base anterior: se apartan (no se borran) para no mezclarlas con la nueva.
        const aside = `${paths.uploads}-anteriores-${backup.stamp()}`;
        fs.renameSync(paths.uploads, aside);
        log(`fotos anteriores apartadas en ${aside}`);
      }
    }
    status("Preparando la base de datos (solo la primera vez)…");
    await pgctl.initCluster({ pgDir, dataDir: paths.pgData, password: config.dbPassword, log });
    writeJson(paths.config, { ...config, initialisedAt: new Date().toISOString() });
  }
  checkpoint();

  status("Abriendo la base de datos…");
  const pgPort = await pgctl.freePort(0);
  await pgctl.start({ pgDir, dataDir: paths.pgData, port: pgPort, logFile: path.join(paths.logs, "postgres.log"), log });
  checkpoint();
  await ensureDatabase(config, pgPort);
  const databaseUrl = `postgres://${pgctl.DB_USER}:${encodeURIComponent(config.dbPassword)}@127.0.0.1:${pgPort}/${DB_NAME}`;

  status("Actualizando la base de datos…");
  await runMigrations(databaseUrl);
  checkpoint();

  status("Abriendo Stocko…");
  const appPort = await pgctl.freePort(config.appPort || PREFERRED_APP_PORT);
  appUrl = `http://127.0.0.1:${appPort}`;
  fs.mkdirSync(paths.uploads, { recursive: true });
  const out = fs.openSync(path.join(paths.logs, "servidor.log"), "a");
  const child = spawn(process.execPath, [path.join(serverDir, "stocko-entry.mjs")], {
    cwd: serverDir,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: serverEnv({
      ELECTRON_RUN_AS_NODE: "1",
      STOCKO_PARENT_PID: String(process.pid),
      STOCKO_DESKTOP: "1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(appPort),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      DB_IDLE_TIMEOUT_MS: "0",
      BETTER_AUTH_SECRET: config.authSecret,
      BETTER_AUTH_URL: appUrl,
      NEXT_PUBLIC_APP_URL: appUrl,
      ENCRYPTION_KEY: config.encryptionKey,
      LOCAL_UPLOADS_DIR: paths.uploads,
    }),
  });
  fs.closeSync(out);
  server = child;
  child.on("error", (error) => {
    child.spawnError = error;
    log(`servidor no arrancó: ${error.stack || error}`);
  });
  child.on("exit", (code) => {
    log(`servidor terminó (código ${code})`);
    // Solo es una caída si estaba funcionando y no lo detuvimos nosotros.
    if (server === child && state === "ready" && !quitting) {
      server = null;
      void serial(onServerCrash);
    }
  });
  await waitForServer(child, appUrl);
  log(`Stocko listo en ${appUrl}`);
}

async function stopServices() {
  const child = server;
  server = null;
  if (child && child.exitCode === null && !child.spawnError) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 8000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
  await pgctl.stop({ pgDir, dataDir: paths.pgData, log });
}

async function pgStopped() {
  return !(await pgctl.isRunning({ pgDir, dataDir: paths.pgData }));
}

/** Arranca todo y muestra Stocko. Si falla, deja la ventana con la ayuda para recuperarse. */
async function startAndShow(options) {
  setState("starting");
  try {
    await startServices(showStatus, options);
    checkpoint();
    await mainWindow.loadURL(appUrl);
    // "Volver" no debe regresar a las pantallas de carga o de error.
    mainWindow.webContents.navigationHistory.clear();
    updateState({ healthyAt: new Date().toISOString(), appVersion: app.getVersion() });
    setState("ready");
    return true;
  } catch (error) {
    if (quitting || error instanceof Aborted) return false;
    await stopServices().catch((e) => log(`al detener tras fallo: ${e}`));
    showFailure(error);
    return false;
  }
}

// ------------------------------------------------------------------ ventana

function escapeHtml(value) {
  return String(value).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
}

function page(body) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Stocko</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f5;--fg:#1c1c1a;--muted:#6b6b66;--accent:#0f766e;--danger:#b42318;--card:#fff;--border:#e4e4e0}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ececea;--muted:#9a9a94;--accent:#2dd4bf;--danger:#f97066;--card:#1c1c1a;--border:#2e2e2b}}
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,"Segoe UI",sans-serif}
main{text-align:center;padding:24px;max-width:620px}h1{font-size:28px;margin:0 0 8px;letter-spacing:-.01em}p{margin:0;color:var(--muted)}
.bar{width:180px;height:4px;margin:20px auto 0;border-radius:4px;background:color-mix(in srgb,var(--accent) 20%,transparent);overflow:hidden}
.bar::after{content:"";display:block;width:40%;height:100%;border-radius:4px;background:var(--accent);animation:m 1.2s ease-in-out infinite}
@keyframes m{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.bar::after{animation:none;width:100%}}
.card{margin-top:20px;text-align:left;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 20px}
.error{color:var(--danger);font-weight:600;margin-bottom:8px}ol{margin:8px 0 0;padding-left:20px;color:var(--fg)}li{margin:4px 0}
code{font-size:13px;word-break:break-all;color:var(--muted)}
.actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:20px}
.btn{display:inline-flex;align-items:center;height:44px;padding:0 18px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--fg);font-weight:600;text-decoration:none}
.btn:hover{border-color:var(--accent)}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
@media (prefers-color-scheme:dark){.btn.primary{color:#0b0b0a}}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.note{margin-top:12px;font-size:14px}
</style></head><body><main>${body}</main></body></html>`)}`;
}

function showStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(
      page(`<h1>Stocko</h1><p>${escapeHtml(message)}</p><div class="bar" role="progressbar" aria-label="Cargando"></div>`),
    );
  }
}

// Botones de la pantalla de error: enlaces a esta dirección (que no existe: .invalid)
// que la ventana intercepta en "will-navigate" en vez de abrirlos.
const PAGE_ACTION = "https://accion.stocko.invalid/";

function showFailure(error) {
  log(`no se pudo abrir: ${error.stack || error}`);
  lastFailure = error;
  setState("failed");
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const backupsCode = `<code>${escapeHtml(paths.backupsRoot)}</code>`;
  if (error === storeSetupError) {
    // Sin la carpeta real del paquete no se toca ningún dato (ni copias ni restauraciones).
    void mainWindow.loadURL(
      page(`<h1>Stocko no pudo abrir</h1>
<div class="card" role="alert"><p class="error">${escapeHtml(error.message)}</p>
<p>Tus copias de seguridad en ${backupsCode} no se tocaron.</p></div>`),
    );
    return;
  }
  if (error.code === "MISSING_DB") {
    void mainWindow.loadURL(
      page(`<h1>Stocko no tiene datos todavía</h1>
<div class="card" role="alert">
<p class="error">${escapeHtml(error.message)}</p>
<p>¿Qué quieres hacer?</p>
<ol>
<li><strong>Restaurar una copia</strong>: recupera tus productos, ventas y clientes. Las automáticas están en ${backupsCode}.</li>
<li><strong>Empezar con datos nuevos</strong>: Stocko arranca vacío. Tus copias no se borran; puedes restaurar una después.</li>
</ol></div>
<div class="actions">
<a class="btn primary" href="${PAGE_ACTION}restaurar">Restaurar una copia…</a>
<a class="btn" href="${PAGE_ACTION}empezar">Empezar con datos nuevos</a>
</div>`),
    );
    return;
  }
  void mainWindow.loadURL(
    page(`<h1>Stocko no pudo abrir</h1>
<div class="card" role="alert">
<p class="error">${escapeHtml(error.message || error)}</p>
<p>Tus copias de seguridad no se tocaron.</p>
<ol>
<li><strong>Reintentar abrir</strong>: si fue algo pasajero.</li>
<li><strong>Restaurar una copia…</strong>: las automáticas están en ${backupsCode}.</li>
<li><strong>Archivo → Abrir la carpeta de datos</strong>: los detalles del error están en <code>logs</code>.</li>
</ol></div>
<div class="actions">
<a class="btn primary" href="${PAGE_ACTION}reintentar">Reintentar abrir</a>
<a class="btn" href="${PAGE_ACTION}restaurar">Restaurar una copia…</a>
</div>`),
  );
}

/** Un botón de la pantalla de error (solo desde esas pantallas, nunca desde Stocko). */
function runPageAction(contents, url) {
  if (contents !== mainWindow?.webContents || !contents.getURL().startsWith("data:text/html")) return;
  const action = url.slice(PAGE_ACTION.length);
  if (action === "restaurar") restoreBackup();
  else if (action === "reintentar") retryStart();
  else if (action === "empezar") startFresh();
}

function setState(next) {
  state = next;
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const usable = (next === "ready" || next === "failed") && !storeSetupError;
  for (const id of ["backup", "restore"]) {
    const item = menu.getMenuItemById(id);
    if (item) item.enabled = usable && !quitting;
  }
  const retry = menu.getMenuItemById("retry");
  if (retry) retry.enabled = next === "failed" && !quitting && !storeSetupError;
  const fresh = menu.getMenuItemById("fresh");
  if (fresh) fresh.enabled = next === "failed" && lastFailure?.code === "MISSING_DB" && !quitting;
  const print = menu.getMenuItemById("print");
  if (print) print.enabled = next === "ready";
}

function isAppUrl(url) {
  return Boolean(appUrl) && (url === appUrl || url.startsWith(`${appUrl}/`));
}

function openOutside(url) {
  try {
    const { protocol } = new URL(url);
    if (["https:", "http:", "mailto:", "tel:", "whatsapp:"].includes(protocol)) void shell.openExternal(url);
  } catch {
    // URL inválida: se ignora
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    title: "Stocko",
    icon: path.join(__dirname, "build", "icon.png"),
    backgroundColor: "#f7f7f5",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // Cerrar la ventana cierra Stocko, pero la ventana queda visible mientras se
  // guarda la copia del día y se detiene la base.
  mainWindow.on("close", (event) => {
    if (shutdownDone) return;
    event.preventDefault();
    app.quit();
  });
  // Windows cierra la sesión o se apaga: deja la base cerrada bien.
  mainWindow.on("session-end", () => pgctl.stopSync({ pgDir, dataDir: paths.pgData }));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Enlaces de WhatsApp, catálogo, etc. que salen de Stocko se abren en el navegador.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    openOutside(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (url.startsWith(PAGE_ACTION)) {
      event.preventDefault();
      runPageAction(contents, url);
      return;
    }
    // Las pantallas propias (data:) se abren con loadURL, que no pasa por aquí: una
    // página no puede navegar a ellas por su cuenta.
    if (isAppUrl(url)) return;
    event.preventDefault();
    openOutside(url);
  });
});

// ------------------------------------------------------------ copias (menú)

/** Detiene todo, hace `task` con la base cerrada y vuelve a abrir. */
async function withServicesStopped(message, task) {
  setState("busy");
  showStatus(message);
  await stopServices();
  if (!(await pgStopped())) {
    await startAndShow();
    throw new Error("No se pudo detener la base de datos. Cierra Stocko, vuelve a abrirlo e inténtalo de nuevo.");
  }
  return task();
}

function makeBackup() {
  if ((state !== "ready" && state !== "failed") || storeSetupError) return;
  void serial(async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "¿Dónde guardo la copia? (mejor en una memoria USB u otro disco)",
      buttonLabel: "Guardar aquí",
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || picked.filePaths.length === 0) return;
    const dest = path.join(picked.filePaths[0], `Stocko-copia-${backup.stamp()}`);
    let failure = null;
    try {
      await withServicesStopped("Guardando la copia de seguridad…", async () => {
        try {
          await backup.copyData(dataRoot, dest, { appVersion: app.getVersion(), pgMajor: await pgctl.bundledMajor(pgDir) });
        } catch (error) {
          failure = error;
        }
      });
    } catch (error) {
      failure = error;
    }
    if (quitting) return;
    if (state === "busy") await startAndShow();
    if (failure) {
      log(`copia falló: ${failure.stack || failure}`);
      dialog.showErrorBox("No se pudo guardar la copia", String(failure.message || failure));
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Copia guardada",
        message: "La copia de seguridad quedó guardada.",
        detail: `${dest}\n\nGuárdala en un lugar seguro: incluye las claves de esta instalación.`,
      });
    }
  });
}

function restoreBackup() {
  if ((state !== "ready" && state !== "failed") || storeSetupError) return;
  void serial(async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "Elige la carpeta de la copia (Stocko-copia-… o auto-…)",
      buttonLabel: "Usar esta copia",
      defaultPath: fs.existsSync(paths.backups) ? paths.backups : paths.backupsRoot,
      properties: ["openDirectory"],
    });
    if (picked.canceled || picked.filePaths.length === 0) return;
    const source = picked.filePaths[0];
    if (!backup.isBackup(source)) {
      dialog.showErrorBox("Esa carpeta no es una copia", "Elige una carpeta Stocko-copia-… o auto-… completa.");
      return;
    }
    const info = backup.describe(source);
    const when = info.createdAt ? new Date(info.createdAt).toLocaleString("es-CO") : "fecha desconocida";
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Restaurar copia",
      message: `¿Reemplazar los datos actuales por la copia del ${when}?`,
      detail: "Se pierde lo que hayas hecho después de esa copia. Los datos de ahora se guardan antes en la carpeta «copias», por si necesitas volver.",
      buttons: ["Restaurar", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
    });
    if (answer.response !== 0) return;

    let safety = null;
    let failure = null;
    try {
      await withServicesStopped("Restaurando la copia…", async () => {
        safety = await backup.restore(dataRoot, source, paths.backups, {
          pgMajor: await pgctl.bundledMajor(pgDir),
          safetyDir: paths.safety,
          log,
        });
      });
    } catch (error) {
      failure = error;
    }
    if (quitting) return;

    if (failure?.code === "ROLLBACK_FAILED") {
      // Los datos quedaron a medias: no se abre. El próximo arranque termina de devolverlos.
      log(`restauración falló sin poder volver atrás: ${failure.stack || failure}`);
      showFailure(failure);
      return;
    }
    if (failure) {
      log(`restauración falló: ${failure.stack || failure}`);
      if (state === "busy") await startAndShow();
      dialog.showErrorBox("No se pudo restaurar", `${failure.message || failure}\n\nTus datos no cambiaron.`);
      return;
    }

    if (await startAndShow()) {
      // Store: los datos de antes pasan a Documentos (sobreviven a desinstalar). No
      // es la base en uso, así que se copia con Stocko abierto.
      // Sin pgdata no había datos que guardar (p. ej. se restauró desde la pantalla de
      // "no tiene datos"): se queda en copias-locales y la limpieza lo retira.
      const hadData = fs.existsSync(path.join(safety, "pgdata", "PG_VERSION"));
      const keptAt = paths.safety !== paths.backups && hadData ? path.join(paths.backups, path.basename(safety)) : safety;
      if (keptAt !== safety) {
        // En la cola: al cerrar, Stocko espera a que termine (y la limpieza no la pisa).
        void serial(() =>
          backup
            .moveBackup(safety, paths.backups)
            .then((dest) => log(`datos de antes de restaurar guardados en ${dest}`))
            .catch((error) => log(`no se pudieron pasar a Documentos los datos de antes de restaurar (quedan en ${safety}): ${error.stack || error}`)),
        );
      }
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Copia restaurada",
        message: "Listo. Stocko ya tiene los datos de la copia.",
        detail: `Los datos anteriores quedaron en ${keptAt}`,
      });
      return;
    }
    if (quitting) return;
    // La copia restaurada no abre: se vuelve a los datos de antes.
    log("la copia restaurada no abrió; se vuelve a los datos anteriores");
    showStatus("La copia no se pudo abrir. Volviendo a tus datos anteriores…");
    await stopServices();
    const undone = (await pgStopped()) && backup.undoRestore(dataRoot, safety, log);
    const reopened = await startAndShow();
    dialog.showErrorBox(
      "La copia no se pudo abrir",
      undone && reopened
        ? "Esa copia está dañada o no es compatible. Se volvieron a poner tus datos anteriores."
        : `Esa copia no se pudo abrir y tampoco se pudo volver atrás automáticamente. Tus datos anteriores están en ${safety}.`,
    );
  });
}

function retryStart() {
  if (state !== "failed") return;
  void serial(async () => {
    await startAndShow();
  });
}

/** Sin base de datos (reinstalación, PC nuevo con copias): crea una vacía si la persona lo confirma. */
function startFresh() {
  if (state !== "failed" || lastFailure?.code !== "MISSING_DB") return;
  void serial(async () => {
    if (state !== "failed" || lastFailure?.code !== "MISSING_DB") return;
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Empezar con datos nuevos",
      message: "¿Empezar Stocko con datos nuevos, sin productos, ventas ni clientes?",
      detail:
        "Tus copias de seguridad no se borran: las de este PC se guardan aparte en una carpeta " +
        "«antes-de-empezar-…» que la limpieza automática no toca. Si las necesitas, puedes restaurar " +
        `una después desde Archivo → Restaurar una copia.\n\nCopias: ${paths.backupsRoot}`,
      buttons: ["Empezar con datos nuevos", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
    });
    if (answer.response !== 0 || quitting) return;
    log("se empieza con datos nuevos (elegido por la persona)");
    await startAndShow({ fresh: true });
  });
}

async function onServerCrash() {
  if (quitting || state !== "ready") return;
  setState("busy");
  const answer = await dialog.showMessageBox(mainWindow, {
    type: "error",
    title: "Stocko se detuvo",
    message: "El servidor de Stocko se cerró de forma inesperada.",
    detail: `Tus datos están a salvo. Detalles en: ${paths.logs}`,
    buttons: ["Volver a abrir", "Salir"],
    defaultId: 0,
  });
  if (answer.response !== 0) {
    app.quit();
    return;
  }
  showStatus("Volviendo a abrir Stocko…");
  await stopServices();
  await startAndShow();
}

// ------------------------------------------------------------------- menús

/** Para la versión portable (sin instalador): acceso directo a este Stocko.exe. */
function createDesktopShortcut() {
  const link = path.join(app.getPath("desktop"), "Stocko.lnk");
  const ok = shell.writeShortcutLink(link, fs.existsSync(link) ? "replace" : "create", {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    description: "Stocko: inventario y ventas",
    icon: fs.existsSync(shortcutIcon) ? shortcutIcon : process.execPath,
    iconIndex: 0,
    appUserModelId: "co.stocko.desktop",
  });
  void dialog.showMessageBox(mainWindow, {
    type: ok ? "info" : "error",
    title: "Acceso directo",
    message: ok ? "Listo: Stocko quedó en tu Escritorio." : "No se pudo crear el acceso directo.",
    detail: ok ? link : "",
  });
}

/**
 * Privacidad, términos y licencias. Con Stocko abierto se muestran en una ventana
 * aparte (sin internet y sin sacar a la persona de lo que está haciendo); si Stocko
 * no pudo abrir, se abre la copia publicada junto al código.
 */
const LEGAL_ONLINE = {
  privacidad: `${updates.REPO_URL}/blob/main/legal/privacidad.md`,
  terminos: `${updates.REPO_URL}/blob/main/legal/terminos.md`,
  licencias: `${updates.REPO_URL}/blob/main/LICENSE`,
};
let legalWindow = null;
function openLegal(page) {
  if (state !== "ready" || !appUrl || !mainWindow || mainWindow.isDestroyed()) {
    openOutside(LEGAL_ONLINE[page]);
    return;
  }
  const url = `${appUrl}/legal/${page}`;
  if (legalWindow && !legalWindow.isDestroyed()) {
    void legalWindow.loadURL(url);
    legalWindow.focus();
    return;
  }
  const child = new BrowserWindow({
    parent: mainWindow,
    width: 860,
    height: 760,
    minWidth: 360,
    minHeight: 480,
    title: "Stocko",
    autoHideMenuBar: true,
    backgroundColor: "#f7f7f5",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  legalWindow = child;
  child.on("closed", () => {
    if (legalWindow === child) legalWindow = null;
  });
  // "Volver a Stocko" (o el logo) en esta ventana: se cierra y queda la ventana principal.
  const leaveLegal = (_event, target) => {
    if (child.isDestroyed() || target.startsWith(`${appUrl}/legal`)) return;
    child.close();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  };
  child.webContents.on("did-navigate", leaveLegal);
  child.webContents.on("did-navigate-in-page", leaveLegal);
  void child.loadURL(url);
}

/** Avisos legales que la licencia pide mostrar: autoría, sin garantía y dónde está la licencia. */
function showAbout() {
  const updatesLine = IS_STORE
    ? "Las actualizaciones llegan por la Microsoft Store."
    : updater?.active
      ? `Actualizaciones: Stocko ${updater.autoEnabled() ? "revisa" : "no revisa"} al abrir si hay una versión nueva (se cambia en este menú).`
      : null;
  void dialog
    .showMessageBox(mainWindow, {
      type: "info",
      title: "Acerca de Stocko",
      message: `Stocko ${app.getVersion()}`,
      detail: [
        "Copyright © 2026 uribevillabona-stack y quienes contribuyen a Stocko.",
        "Stocko es software libre: puedes usarlo, estudiarlo, compartirlo y modificarlo bajo la licencia GNU AGPL versión 3. " +
          "Se entrega SIN NINGUNA GARANTÍA, en la medida en que la ley lo permita.",
        `Funciona sin internet: todo se guarda en este PC.\nDatos: ${dataRoot}\n` +
          `Copias automáticas (al abrir y al cerrar; 7 diarias y 4 semanales): ${paths.backups}`,
        updatesLine,
      ]
        .filter(Boolean)
        .join("\n\n"),
      buttons: ["Cerrar", "Ver la licencia", "Código fuente"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then((answer) => {
      if (answer.response === 1) openLegal("licencias");
      else if (answer.response === 2) openOutside(updates.REPO_URL);
    });
}

function buildMenu() {
  const template = [
    {
      label: "Archivo",
      submenu: [
        { id: "backup", label: "Hacer copia de seguridad…", enabled: false, click: makeBackup },
        { id: "restore", label: "Restaurar una copia…", enabled: false, click: restoreBackup },
        { type: "separator" },
        { id: "retry", label: "Reintentar abrir", enabled: false, click: retryStart },
        { id: "fresh", label: "Empezar con datos nuevos…", enabled: false, click: startFresh },
        { id: "print", label: "Imprimir…", accelerator: "CmdOrCtrl+P", enabled: false, click: () => mainWindow?.webContents.print() },
        { type: "separator" },
        { label: "Abrir la carpeta de datos", click: () => void shell.openPath(dataRoot) },
        ...(app.isPackaged && !IS_STORE
          ? [{ label: "Crear acceso directo en el Escritorio", click: createDesktopShortcut }]
          : []),
        { type: "separator" },
        { label: "Salir", role: "quit" },
      ],
    },
    {
      label: "Editar",
      submenu: [
        { label: "Deshacer", role: "undo" },
        { label: "Rehacer", role: "redo" },
        { type: "separator" },
        { label: "Cortar", role: "cut" },
        { label: "Copiar", role: "copy" },
        { label: "Pegar", role: "paste" },
        { label: "Seleccionar todo", role: "selectAll" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { label: "Volver", accelerator: "Alt+Left", click: () => mainWindow?.webContents.navigationHistory.goBack() },
        { label: "Recargar", role: "reload" },
        { type: "separator" },
        { label: "Aumentar", role: "zoomIn" },
        { label: "Reducir", role: "zoomOut" },
        { label: "Tamaño normal", role: "resetZoom" },
        { type: "separator" },
        { label: "Pantalla completa", role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ label: "Herramientas de desarrollo", role: "toggleDevTools" }]),
      ],
    },
    {
      label: "Ayuda",
      submenu: [
        ...(updater?.active
          ? [
              { label: "Buscar actualizaciones…", click: () => void updater.checkNow() },
              {
                label: "Buscar actualizaciones al abrir",
                type: "checkbox",
                checked: updater.autoEnabled(),
                click: (item) => updater.setAuto(item.checked),
              },
              { type: "separator" },
            ]
          : []),
        { label: "Política de privacidad", click: () => openLegal("privacidad") },
        { label: "Términos de uso", click: () => openLegal("terminos") },
        { label: "Licencias", click: () => openLegal("licencias") },
        { label: "Código fuente", click: () => openOutside(updates.REPO_URL) },
        { type: "separator" },
        { label: "Acerca de Stocko", click: showAbout },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ------------------------------------------------------------------ ciclo

/** Copias al abrir: la del día y, si cambió la versión, una antes de migrar. */
async function startupBackups(previous) {
  if (!pgctl.isInitialised(paths.pgData) || !(await pgStopped())) return;
  const meta = { appVersion: app.getVersion(), pgMajor: await pgctl.bundledMajor(pgDir) };
  // Solo se copian datos de una sesión que abrió bien (no copias de una base dañada).
  if (previous.healthyAt) {
    try {
      const created = await backup.autoBackup(dataRoot, paths.backups, { meta });
      if (created) log(`copia automática: ${created}`);
    } catch (error) {
      log(`copia automática falló: ${error.stack || error}`);
    }
  }
  if (paths.safety !== paths.backups) {
    // Datos de antes de restaurar que no alcanzaron a pasar a Documentos: se conservan los 5 últimos.
    await backup.pruneBackups(paths.safety).catch((error) => log(`limpiar copias locales falló: ${error}`));
  }
  const updatePrefix = `antes-de-actualizar-${previous.appVersion}-a-${app.getVersion()}-`;
  let alreadySaved = false;
  try {
    alreadySaved =
      fs.existsSync(paths.backups) &&
      fs.readdirSync(paths.backups).some((n) => n.startsWith(updatePrefix) && backup.isBackup(path.join(paths.backups, n)));
  } catch (error) {
    log(`no se pudo leer la carpeta de copias: ${error}`);
  }
  if (previous.appVersion && previous.appVersion !== app.getVersion() && !alreadySaved) {
    try {
      showStatus("Guardando una copia antes de actualizar…");
      const dest = path.join(paths.backups, `${updatePrefix}${backup.stamp()}`);
      await backup.copyData(dataRoot, dest, meta);
      log(`copia antes de actualizar: ${dest}`);
    } catch (error) {
      log(`copia antes de actualizar falló: ${error.stack || error}`);
    }
  }
}

async function bootstrap() {
  if (storeSetupError) {
    // No se toca nada en la carpeta de reemplazo (podría ser la de una instalación .exe).
    showFailure(storeSetupError);
    return;
  }
  try {
    rotateLogs();
    log(`Stocko ${app.getVersion()} — datos en ${dataRoot} — copias en ${paths.backups}`);
    for (const note of startupNotes) log(note);
    fs.mkdirSync(dataRoot, { recursive: true });
    pgctl.cleanupStale(dataRoot);
    // Una base que quedó abierta de una sesión que se cerró mal.
    if (pgctl.isInitialised(paths.pgData) && !(await pgStopped())) await pgctl.stop({ pgDir, dataDir: paths.pgData, log });
    backup.recoverPendingRestore(dataRoot, log);
    // Actualización descargada que quedó para "la próxima vez que abra Stocko": se instala
    // ahora, con la base todavía cerrada. La versión nueva guarda su copia al abrir.
    if (await updater.installAtStartup(showStatus)) {
      app.quit();
      return;
    }
    checkpoint();
    const previous = readState();
    updateState({ healthyAt: null, startedAt: new Date().toISOString() });
    checkpoint();
    await startupBackups(previous);
    checkpoint();
  } catch (error) {
    if (quitting || error instanceof Aborted) return;
    showFailure(error);
    return;
  }
  await startAndShow();
}

async function shutdown() {
  const healthy = state === "ready";
  setState("busy");
  showStatus("Cerrando Stocko…");
  await stopServices();
  // Copia del día al cerrar, con lo trabajado hoy.
  if (healthy && pgctl.isInitialised(paths.pgData) && (await pgStopped())) {
    showStatus("Guardando la copia del día…");
    try {
      await backup.autoBackup(dataRoot, paths.backups, {
        meta: { appVersion: app.getVersion(), pgMajor: await pgctl.bundledMajor(pgDir) },
        replace: true,
      });
    } catch (error) {
      log(`copia al cerrar falló: ${error.stack || error}`);
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  // Ya hay un Stocko abierto: ese recibe el foco (abajo, "second-instance").
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || quitting) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (shutdownDone) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    setState(state);
    // Espera a que termine lo que esté en curso (arranque, copia…) y luego cierra.
    serial(shutdown)
      .then(
        () => true,
        (error) => {
          log(`al cerrar: ${error.stack || error}`);
          return false;
        },
      )
      // «Actualizar ahora»: el instalador solo arranca si Stocko cerró bien y la base quedó detenida.
      .then((closed) => updater?.installOnQuit({ clean: async () => closed && (await pgStopped()) }))
      .catch((error) => log(`al instalar la actualización: ${error.stack || error}`))
      .finally(() => {
        shutdownDone = true;
        app.quit();
      });
  });

  app.whenReady().then(() => {
    updater = updates.create({
      app,
      dialog,
      shell,
      kind: updates.installKind({ isStore: IS_STORE, isPackaged: app.isPackaged, exePath: process.execPath }),
      log,
      readState,
      updateState,
      getWindow: () => mainWindow,
      canPrompt: () => state === "ready" && !quitting && Boolean(mainWindow) && !mainWindow.isDestroyed(),
      quit: () => app.quit(),
    });
    Menu.setApplicationMenu(buildMenu());
    // Solo se permite copiar al portapapeles (botones "Copiar"). Nada de cámara, ubicación, etc.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === "clipboard-sanitized-write"),
    );
    createWindow();
    showStatus("Abriendo Stocko…");
    void serial(bootstrap);
    updater.start();
  });
}
