"use strict";
// Copias de seguridad de Stocko para Windows.
// Una copia = pgdata (con la base detenida) + config.json + fotos + stocko-copia.json.
// Sin config.json la copia no sirve: guarda la contraseña de la base y la clave
// que cifra los secretos de WhatsApp.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ITEMS = ["pgdata", "config.json", "fotos"];
const MARKER = "stocko-copia.json";
const JOURNAL = "restauracion-pendiente.json";
const AUTO_PREFIX = "auto-";
const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;
const KEEP_SAFETY = 5;

const skipRuntimeFiles = (src) => !/[\\/]postmaster\.(pid|opts)$/.test(src);

function pad(n) {
  return String(n).padStart(2, "0");
}

function stamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function dayKey(date = new Date()) {
  return stamp(date).slice(0, 10);
}

function exists(p) {
  return fs.existsSync(p);
}

function sameOrInside(child, parent) {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function dirSize(target) {
  let total = 0;
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  for (const entry of await fsp.readdir(target)) total += await dirSize(path.join(target, entry));
  return total;
}

async function dataSize(dataRoot) {
  let total = 0;
  for (const item of ITEMS) total += await dirSize(path.join(dataRoot, item));
  return total;
}

/** Comprueba que haya espacio para copiar `bytes` (con margen). */
function assertFreeSpace(dir, bytes) {
  let free;
  try {
    const stats = fs.statfsSync(dir);
    free = stats.bavail * stats.bsize;
  } catch {
    return; // sin dato: se intenta igual
  }
  const needed = bytes * 1.2 + 100 * 1024 * 1024;
  if (free < needed) {
    const mb = (n) => `${Math.ceil(n / 1024 / 1024)} MB`;
    throw new Error(`No hay espacio suficiente en el disco: se necesitan ${mb(needed)} y hay ${mb(free)}.`);
  }
}

/** Quita "solo lectura" (copias que vienen de un DVD o similar): Postgres necesita escribir. */
async function makeWritable(target) {
  const stat = await fsp.stat(target);
  if (stat.isDirectory()) {
    for (const entry of await fsp.readdir(target)) await makeWritable(path.join(target, entry));
  } else {
    await fsp.chmod(target, 0o666);
  }
}

async function writeMarker(dir, meta) {
  await fsp.writeFile(path.join(dir, MARKER), JSON.stringify({ createdAt: new Date().toISOString(), ...meta }, null, 2));
}

/** Copia los datos a `dest`. Solo queda con ese nombre si se copió completa. */
async function copyData(dataRoot, dest, meta = {}) {
  if (exists(dest)) throw new Error(`Ya existe ${dest}`);
  const temp = `${dest}.parcial`;
  await fsp.rm(temp, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  assertFreeSpace(path.dirname(dest), await dataSize(dataRoot));
  try {
    await fsp.mkdir(temp, { recursive: true });
    for (const item of ITEMS) {
      const from = path.join(dataRoot, item);
      if (exists(from)) await fsp.cp(from, path.join(temp, item), { recursive: true, filter: skipRuntimeFiles });
    }
    // El marcador va al final: una copia sin él está incompleta.
    await writeMarker(temp, meta);
    renameRetry(temp, dest);
  } catch (error) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return dest;
}

function isBackup(dir) {
  return (
    !dir.endsWith(".parcial") &&
    exists(path.join(dir, MARKER)) &&
    exists(path.join(dir, "pgdata", "PG_VERSION")) &&
    exists(path.join(dir, "config.json"))
  );
}

function describe(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MARKER), "utf8"));
  } catch {
    return {};
  }
}

function clusterMajor(pgdata) {
  try {
    return Number.parseInt(fs.readFileSync(path.join(pgdata, "PG_VERSION"), "utf8").trim(), 10);
  } catch {
    return null;
  }
}

/** ISO año-semana, para conservar una copia por semana. */
function weekKey(day) {
  const date = new Date(`${day}T12:00:00`);
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-${week}`;
}

/** Espera síncrona corta (solo para reintentos de renombrado). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Renombra reintentando: en Windows el antivirus o el indexador pueden tener
 * abiertos por un momento archivos recién escritos (EPERM/EBUSY).
 */
function renameRetry(from, to, attempts = 8) {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (i >= attempts || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      sleepSync(200 * i);
    }
  }
}

/** Escribe y fuerza a disco antes de renombrar: un corte de luz no deja un diario vacío. */
function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  renameRetry(temp, file);
}

/**
 * Copias automáticas: conserva las 7 más recientes y, de las anteriores, la
 * última de cada semana (4). De las copias "antes de…" (actualizar/restaurar)
 * conserva las 5 más recientes de cada tipo. Quita copias a medias.
 */
/**
 * Borra una copia sobrante. Si no se puede (p. ej. OneDrive la tiene abierta) se
 * deja para la próxima vez: limpiar nunca debe impedir hacer la copia nueva.
 */
async function removeQuietly(target) {
  try {
    await fsp.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // se intenta de nuevo en la próxima limpieza
  }
}

async function pruneBackups(backupsDir) {
  if (!exists(backupsDir)) return;
  const names = await fsp.readdir(backupsDir);

  // Un reemplazo de la copia del día que se cortó: se recupera la buena.
  for (const name of names.filter((n) => /^auto-\d{4}-\d{2}-\d{2}$/.test(n.replace(/\.(nueva|vieja)$/, "")))) {
    const base = path.join(backupsDir, name.replace(/\.(nueva|vieja)$/, ""));
    if (exists(base)) continue;
    try {
      if (name.endsWith(".nueva") && isBackup(path.join(backupsDir, name))) renameRetry(path.join(backupsDir, name), base);
      else if (name.endsWith(".vieja") && isBackup(path.join(backupsDir, name))) renameRetry(path.join(backupsDir, name), base);
    } catch {
      // se recupera en la próxima limpieza
    }
  }

  const current = await fsp.readdir(backupsDir);
  for (const name of current.filter((n) => /\.(parcial|nueva|vieja)$/.test(n))) {
    await removeQuietly(path.join(backupsDir, name));
  }

  const autos = current.filter((n) => /^auto-\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse();
  const keep = new Set(autos.slice(0, KEEP_DAILY));
  const weeks = new Set();
  for (const name of autos.slice(KEEP_DAILY)) {
    const week = weekKey(name.slice(AUTO_PREFIX.length));
    if (weeks.has(week) || weeks.size >= KEEP_WEEKLY) continue;
    weeks.add(week);
    keep.add(name);
  }
  for (const prefix of ["antes-de-actualizar-", "antes-de-restaurar-"]) {
    // El nombre termina en la fecha (AAAA-MM-DD-hhmmss): se ordena por ella.
    const byDate = current
      .filter((n) => n.startsWith(prefix) && !/\.(parcial|nueva|vieja)$/.test(n))
      .sort((a, b) => a.slice(-17).localeCompare(b.slice(-17)))
      .reverse();
    for (const name of byDate.slice(0, KEEP_SAFETY)) keep.add(name);
    for (const name of byDate.slice(KEEP_SAFETY)) await removeQuietly(path.join(backupsDir, name));
  }
  for (const name of autos) {
    if (!keep.has(name)) await removeQuietly(path.join(backupsDir, name));
  }
}

/**
 * Copia automática del día (`auto-AAAA-MM-DD`). Con `replace`, rehace la de hoy
 * (al cerrar Stocko, para guardar el trabajo del día). El reemplazo nunca deja
 * el día sin copia: la anterior se aparta (.vieja) hasta que la nueva está lista.
 */
async function autoBackup(dataRoot, backupsDir, { meta, replace = false } = {}) {
  if (!exists(path.join(dataRoot, "pgdata", "PG_VERSION"))) return null;
  await fsp.mkdir(backupsDir, { recursive: true });
  const dest = path.join(backupsDir, `${AUTO_PREFIX}${dayKey()}`);
  // La limpieza va después de la copia: si falla, la copia del día ya está hecha.
  try {
    if (exists(dest) && !replace) return null;
    if (!exists(dest)) return await copyData(dataRoot, dest, { ...meta, automatic: true });
    const fresh = `${dest}.nueva`;
    const old = `${dest}.vieja`;
    await fsp.rm(fresh, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await copyData(dataRoot, fresh, { ...meta, automatic: true });
    await fsp.rm(old, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    renameRetry(dest, old);
    renameRetry(fresh, dest);
    await removeQuietly(old);
    return dest;
  } finally {
    await pruneBackups(backupsDir).catch(() => {});
  }
}

/**
 * Pasa una copia a otra carpeta (posiblemente otro disco u OneDrive): la copia
 * entera primero (`.parcial`) y solo entonces borra el original.
 */
async function moveBackup(source, destDir) {
  const dest = path.join(destDir, path.basename(source));
  const partial = `${dest}.parcial`;
  await fsp.mkdir(destDir, { recursive: true });
  await fsp.rm(partial, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fsp.cp(source, partial, { recursive: true });
  const complete = [MARKER, "config.json", path.join("pgdata", "PG_VERSION")].every((item) => exists(path.join(partial, item)));
  if (!complete || (await dirSize(partial)) !== (await dirSize(source))) {
    throw new Error(`La copia en ${partial} quedó incompleta.`);
  }
  renameRetry(partial, dest);
  await removeQuietly(source);
  return dest;
}

/**
 * Antes de empezar con datos nuevos: aparta las copias existentes en una carpeta
 * `antes-de-empezar-…` que la limpieza automática no toca. Así las copias de la base
 * nueva (vacía) nunca reemplazan ni desplazan a las de los datos anteriores.
 * Devuelve la carpeta, o null si no había copias.
 */
function setAsideBackups(backupsDir, label) {
  let names;
  try {
    names = fs.readdirSync(backupsDir);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const movable = names.filter((n) => /^(auto-|antes-de-actualizar-|antes-de-restaurar-)/.test(n));
  if (movable.length === 0) return null;
  const dest = path.join(backupsDir, label);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of movable) renameRetry(path.join(backupsDir, name), path.join(dest, name));
  return dest;
}

// ------------------------------------------------------------- restaurar

function journalPath(dataRoot) {
  return path.join(dataRoot, JOURNAL);
}

class RollbackFailedError extends Error {
  constructor() {
    super(
      "La restauración falló y no se pudo volver atrás del todo. Cierra Stocko y vuelve a abrirlo: " +
        "al arrancar terminará de devolver tus datos. Si sigue fallando, revisa la carpeta «copias».",
    );
    this.code = "ROLLBACK_FAILED";
  }
}

/**
 * Devuelve los datos de `safety` a su sitio. Lo que esté ahora en dataRoot y
 * haya llegado con la restauración (`incoming`) se aparta a `stage`. Cada paso
 * es independiente: si uno falla se registra y el diario se conserva para
 * reintentar en el próximo arranque.
 */
function rollbackRestore(dataRoot, log = () => {}) {
  const file = journalPath(dataRoot);
  if (!exists(file)) return true;
  let journal;
  try {
    journal = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    // Diario ilegible (corte de luz al escribirlo): el intercambio aún no había empezado.
    log(`diario de restauración ilegible, se aparta: ${error}`);
    renameRetry(file, `${file}.ilegible-${Date.now()}`);
    return true;
  }
  const { stage, safety, incoming = ITEMS } = journal;
  let ok = true;
  fs.mkdirSync(stage, { recursive: true });
  for (const item of ITEMS) {
    const saved = path.join(safety, item);
    const current = path.join(dataRoot, item);
    try {
      if (exists(saved)) {
        if (exists(current)) renameRetry(current, path.join(stage, `${item}.${Date.now()}`));
        renameRetry(saved, current);
        log(`restauración deshecha: ${item}`);
      } else if (incoming.includes(item) && exists(current) && !exists(path.join(stage, item))) {
        // Llegó con la copia (ya salió de `stage`) y antes no existía (p. ej. fotos): se retira.
        // Si todavía está en `stage`, el intercambio nunca llegó a este item y lo de
        // dataRoot es el ORIGINAL: no se toca.
        renameRetry(current, path.join(stage, `${item}.${Date.now()}`));
      }
    } catch (error) {
      ok = false;
      log(`no se pudo devolver ${item}: ${error.stack || error}`);
    }
  }
  if (ok) {
    fs.rmSync(file, { force: true });
    fs.rmSync(stage, { recursive: true, force: true });
    try {
      if (fs.readdirSync(safety).every((n) => n === MARKER)) fs.rmSync(safety, { recursive: true, force: true });
    } catch {
      // ya no existe
    }
  }
  return ok;
}

/** Al arrancar: termina de deshacer una restauración que se cortó y limpia restos. */
function recoverPendingRestore(dataRoot, log = () => {}) {
  if (exists(journalPath(dataRoot))) {
    log("restauración a medias encontrada: se vuelve a los datos anteriores");
    if (!rollbackRestore(dataRoot, log)) {
      throw new Error("Una restauración anterior quedó a medias y no se pudo deshacer. Revisa la carpeta «copias».");
    }
  }
  for (const name of fs.existsSync(dataRoot) ? fs.readdirSync(dataRoot) : []) {
    if (name.startsWith(".restaurando-") || name.startsWith(".deshecho-")) {
      fs.rmSync(path.join(dataRoot, name), { recursive: true, force: true });
    }
  }
}

function validateSource(dataRoot, backupsDir, source, safetyDir = backupsDir) {
  if (sameOrInside(source, dataRoot) && !sameOrInside(source, backupsDir) && !sameOrInside(source, safetyDir)) {
    throw new Error("Esa es la carpeta de datos actual de Stocko, no una copia. Elige una carpeta Stocko-copia-… o auto-….");
  }
  if (sameOrInside(source, backupsDir) && path.resolve(source).toLowerCase() === path.resolve(backupsDir).toLowerCase()) {
    throw new Error("Elige una copia dentro de «copias» (auto-… o antes-de-…), no la carpeta completa.");
  }
  if (!isBackup(source)) {
    throw new Error("Esa carpeta no es una copia completa de Stocko. Elige una carpeta Stocko-copia-… o auto-….");
  }
}

/**
 * Reemplaza los datos actuales por los de `source`:
 *  1. copia la fuente a una carpeta temporal (los datos actuales no se tocan),
 *  2. anota el cambio en un diario,
 *  3. intercambia carpetas con renombres (instantáneo),
 *  4. los datos anteriores quedan en `<safetyDir>/antes-de-restaurar-…` (restaurables).
 * `safetyDir` (por defecto `backupsDir`) debe estar en el mismo disco que dataRoot:
 * los datos actuales se mueven allí con renombres.
 * Si algo falla, todo vuelve a como estaba; si se corta la luz, el próximo
 * arranque deshace el cambio a medias. Si ni siquiera se puede volver atrás,
 * lanza RollbackFailedError (code "ROLLBACK_FAILED"): no hay que abrir Stocko.
 */
async function restore(dataRoot, source, backupsDir, { pgMajor, safetyDir = backupsDir, log = () => {} } = {}) {
  if (exists(journalPath(dataRoot))) {
    throw new Error("Hay una restauración anterior sin terminar. Cierra Stocko y vuelve a abrirlo para que la termine de deshacer.");
  }
  validateSource(dataRoot, backupsDir, source, safetyDir);
  const sourceMajor = clusterMajor(path.join(source, "pgdata"));
  if (!pgMajor) throw new Error("No se pudo comprobar la versión de la base de datos de Stocko.");
  if (sourceMajor !== pgMajor) {
    throw new Error(`La copia es de otra versión de la base de datos (${sourceMajor}; esta versión de Stocko usa ${pgMajor}).`);
  }

  const id = stamp();
  const stage = path.join(dataRoot, `.restaurando-${id}`);
  const safety = path.join(safetyDir, `antes-de-restaurar-${id}`);
  await fsp.rm(stage, { recursive: true, force: true });
  // Los datos actuales solo se mueven (mismo disco): basta espacio para la copia.
  assertFreeSpace(dataRoot, await dataSize(source));
  const incoming = [];
  try {
    await fsp.mkdir(stage, { recursive: true });
    for (const item of ITEMS) {
      const from = path.join(source, item);
      if (!exists(from)) continue;
      await fsp.cp(from, path.join(stage, item), { recursive: true, filter: skipRuntimeFiles });
      incoming.push(item);
    }
    await makeWritable(stage);
    if (!exists(path.join(stage, "pgdata", "PG_VERSION")) || !exists(path.join(stage, "config.json"))) {
      throw new Error("La copia se leyó incompleta. Revisa la memoria o el disco e inténtalo de nuevo.");
    }
  } catch (error) {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  fs.mkdirSync(safety, { recursive: true });
  // El marcador va antes del intercambio: si algo se corta, los datos que alcancen a
  // moverse a `safety` siguen reconocibles como copia (isBackup exige pgdata y config.json).
  await writeMarker(safety, { kind: "antes-de-restaurar", pgMajor });
  writeJsonAtomic(journalPath(dataRoot), { stage, safety, source, incoming });
  try {
    for (const item of ITEMS) {
      const current = path.join(dataRoot, item);
      if (exists(current)) renameRetry(current, path.join(safety, item));
      const arriving = path.join(stage, item);
      if (exists(arriving)) renameRetry(arriving, current);
    }
  } catch (error) {
    log(`intercambio falló: ${error.stack || error}`);
    if (!rollbackRestore(dataRoot, log)) throw new RollbackFailedError();
    throw error;
  }
  fs.rmSync(journalPath(dataRoot), { force: true });
  fs.rmSync(stage, { recursive: true, force: true });
  return safety;
}

/** Vuelve a los datos de antes de una restauración que no se pudo abrir. */
function undoRestore(dataRoot, safety, log = () => {}) {
  // Todo lo que hay ahora en dataRoot llegó con la copia (lo de antes está en `safety`).
  writeJsonAtomic(journalPath(dataRoot), { stage: path.join(dataRoot, `.deshecho-${stamp()}`), safety, incoming: ITEMS });
  return rollbackRestore(dataRoot, log);
}

/** ¿Hay alguna copia completa en `copias`? (para no crear una base vacía si ya hubo datos) */
function hasAnyBackup(backupsDir) {
  let names;
  try {
    names = fs.readdirSync(backupsDir);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    // Existe pero no se puede leer (disco o red no disponible): no se asume que no hay copias.
    throw new Error(`No se pudo revisar la carpeta de copias (${backupsDir}): ${error.message}`);
  }
  return names.some(
    (name) =>
      isBackup(path.join(backupsDir, name)) ||
      // Datos apartados por una restauración, aunque les falte el marcador.
      (name.startsWith("antes-de-restaurar-") && exists(path.join(backupsDir, name, "pgdata", "PG_VERSION"))) ||
      // Copias apartadas al empezar con datos nuevos (un nivel más adentro).
      (name.startsWith("antes-de-empezar-") && !name.includes(".") && hasAnyBackup(path.join(backupsDir, name))),
  );
}

module.exports = {
  autoBackup,
  clusterMajor,
  copyData,
  describe,
  hasAnyBackup,
  isBackup,
  moveBackup,
  pruneBackups,
  recoverPendingRestore,
  restore,
  setAsideBackups,
  stamp,
  undoRestore,
};
