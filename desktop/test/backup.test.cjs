"use strict";
// Pruebas de las copias de seguridad (sin Postgres: carpetas falsas).
// Ejecutar: node --test desktop/test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const backup = require("../lib/backup.cjs");
const pgctl = require("../lib/postgres.cjs");

function fakeData(root, label) {
  fs.mkdirSync(path.join(root, "pgdata", "base"), { recursive: true });
  fs.writeFileSync(path.join(root, "pgdata", "PG_VERSION"), "18\n");
  fs.writeFileSync(path.join(root, "pgdata", "base", "datos"), label);
  fs.writeFileSync(path.join(root, "pgdata", "postmaster.pid"), "123");
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ label }));
  fs.mkdirSync(path.join(root, "fotos"), { recursive: true });
  fs.writeFileSync(path.join(root, "fotos", "a.webp"), label);
}
const read = (root) => fs.readFileSync(path.join(root, "pgdata", "base", "datos"), "utf8");

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "stocko-copias-"));
  const dataRoot = path.join(base, "Stocko");
  const backups = path.join(dataRoot, "copias");
  fakeData(dataRoot, "original");
  return { base, dataRoot, backups };
}

test("copia completa con marcador, sin archivos de Postgres en marcha", async () => {
  const { base, dataRoot } = setup();
  const dest = await backup.copyData(dataRoot, path.join(base, "usb", "Stocko-copia-1"), { pgMajor: 18 });
  assert.ok(backup.isBackup(dest));
  assert.equal(read(dest), "original");
  assert.ok(!fs.existsSync(path.join(dest, "pgdata", "postmaster.pid")));
  assert.equal(backup.describe(dest).pgMajor, 18);
  await assert.rejects(backup.copyData(dataRoot, dest), /Ya existe/);
});

test("una carpeta .parcial o sin marcador no es una copia", async () => {
  const { base, dataRoot } = setup();
  const dest = await backup.copyData(dataRoot, path.join(base, "c"));
  fs.renameSync(dest, `${dest}.parcial`);
  assert.ok(!backup.isBackup(`${dest}.parcial`));
  const noMarker = path.join(base, "sin-marcador");
  fakeData(noMarker, "x");
  assert.ok(!backup.isBackup(noMarker));
});

test("restaurar reemplaza los datos y guarda los anteriores restaurables", async () => {
  const { base, dataRoot, backups } = setup();
  const copy = await backup.copyData(dataRoot, path.join(base, "usb", "copia"));
  fs.writeFileSync(path.join(dataRoot, "pgdata", "base", "datos"), "cambiado después");
  const safety = await backup.restore(dataRoot, copy, backups, { pgMajor: 18 });
  assert.equal(read(dataRoot), "original");
  assert.equal(read(safety), "cambiado después");
  assert.ok(backup.isBackup(safety), "los datos anteriores quedan como copia restaurable");
  assert.ok(!fs.existsSync(path.join(dataRoot, "restauracion-pendiente.json")));
  assert.ok(!fs.readdirSync(dataRoot).some((n) => n.startsWith(".restaurando-")));
});

test("rechaza la carpeta de datos actual, la carpeta «copias» completa y otra versión de Postgres", async () => {
  const { base, dataRoot, backups } = setup();
  fs.writeFileSync(path.join(dataRoot, "stocko-copia.json"), "{}");
  await assert.rejects(backup.restore(dataRoot, dataRoot, backups, { pgMajor: 18 }), /carpeta de datos actual/);
  await assert.rejects(backup.restore(dataRoot, dataRoot.toUpperCase(), backups, { pgMajor: 18 }), /carpeta de datos actual/);
  fs.mkdirSync(backups, { recursive: true });
  await assert.rejects(backup.restore(dataRoot, backups, backups, { pgMajor: 18 }), /no la carpeta completa/);
  const copy = await backup.copyData(dataRoot, path.join(base, "otra"));
  fs.writeFileSync(path.join(copy, "pgdata", "PG_VERSION"), "19\n");
  await assert.rejects(backup.restore(dataRoot, copy, backups, { pgMajor: 18 }), /otra versión/);
  assert.equal(read(dataRoot), "original", "los datos no cambiaron");
});

test("restaurar una copia de solo lectura deja los archivos escribibles", async () => {
  const { base, dataRoot, backups } = setup();
  const copy = await backup.copyData(dataRoot, path.join(base, "dvd"));
  fs.chmodSync(path.join(copy, "pgdata", "base", "datos"), 0o444);
  await backup.restore(dataRoot, copy, backups, { pgMajor: 18 });
  fs.appendFileSync(path.join(dataRoot, "pgdata", "base", "datos"), "!"); // no lanza
});

test("un intercambio cortado a la mitad se deshace al arrancar", async () => {
  const { base, dataRoot, backups } = setup();
  // Simula un corte de luz justo después de mover pgdata a la carpeta de seguridad.
  const safety = path.join(backups, "antes-de-restaurar-x");
  const stage = path.join(dataRoot, ".restaurando-x");
  fs.mkdirSync(safety, { recursive: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "restauracion-pendiente.json"), JSON.stringify({ stage, safety }));
  fs.renameSync(path.join(dataRoot, "pgdata"), path.join(safety, "pgdata"));
  fakeData(path.join(base, "entrante"), "de la copia");
  fs.renameSync(path.join(base, "entrante", "pgdata"), path.join(dataRoot, "pgdata"));

  backup.recoverPendingRestore(dataRoot);
  assert.equal(read(dataRoot), "original");
  assert.ok(!fs.existsSync(path.join(dataRoot, "restauracion-pendiente.json")));
  assert.ok(!fs.existsSync(stage));
});

test("deshacer una restauración que no abrió devuelve los datos anteriores", async () => {
  const { base, dataRoot, backups } = setup();
  const copy = await backup.copyData(dataRoot, path.join(base, "copia"));
  fs.writeFileSync(path.join(dataRoot, "pgdata", "base", "datos"), "lo de hoy");
  const safety = await backup.restore(dataRoot, copy, backups, { pgMajor: 18 });
  assert.ok(backup.undoRestore(dataRoot, safety));
  assert.equal(read(dataRoot), "lo de hoy");
  assert.ok(!fs.existsSync(safety));
});

test("copias automáticas: una por día, se rehace al cerrar y se conservan 7 diarias + 4 semanales", async () => {
  const { dataRoot, backups } = setup();
  const first = await backup.autoBackup(dataRoot, backups, { meta: {} });
  assert.ok(first && backup.isBackup(first));
  assert.equal(await backup.autoBackup(dataRoot, backups, { meta: {} }), null, "no repite el mismo día");
  fs.writeFileSync(path.join(dataRoot, "pgdata", "base", "datos"), "fin del día");
  await backup.autoBackup(dataRoot, backups, { meta: {}, replace: true });
  assert.equal(read(first), "fin del día");

  // 40 días de copias anteriores.
  const today = new Date();
  for (let i = 1; i <= 40; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const name = `auto-${backup.stamp(d).slice(0, 10)}`;
    fakeData(path.join(backups, name), name);
    fs.writeFileSync(path.join(backups, name, "stocko-copia.json"), "{}");
  }
  fs.mkdirSync(path.join(backups, "auto-2020-01-01.parcial"));
  fs.mkdirSync(path.join(backups, "antes-de-actualizar-0.1.0-a-0.2.0"));
  await backup.autoBackup(dataRoot, backups, { meta: {} });
  const autos = fs.readdirSync(backups).filter((n) => n.startsWith("auto-"));
  assert.equal(autos.length, 7 + 4, autos.join(", "));
  assert.ok(!autos.some((n) => n.endsWith(".parcial")));
  assert.ok(fs.existsSync(path.join(backups, "antes-de-actualizar-0.1.0-a-0.2.0")), "no toca otras copias");
});

test("sin espacio en disco no deja copias a medias", async () => {
  const { base, dataRoot } = setup();
  const realStatfs = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 1, bsize: 1 });
  try {
    await assert.rejects(backup.copyData(dataRoot, path.join(base, "llena")), /espacio suficiente/);
  } finally {
    fs.statfsSync = realStatfs;
  }
  assert.ok(!fs.existsSync(path.join(base, "llena.parcial")));
  assert.ok(!fs.existsSync(path.join(base, "llena")));
});

test("lee la versión mayor de pg_ctl", () => {
  assert.equal(pgctl.parseMajor("pg_ctl (PostgreSQL) 18.4\r\n"), 18);
  assert.equal(pgctl.parseMajor("pg_ctl (PostgreSQL) 19beta1"), 19);
  assert.equal(pgctl.parseMajor("algo raro"), null);
});

test("sin versión de Postgres no se restaura", async () => {
  const { base, dataRoot, backups } = setup();
  const copy = await backup.copyData(dataRoot, path.join(base, "copia"));
  await assert.rejects(backup.restore(dataRoot, copy, backups, { pgMajor: null }), /comprobar la versión/);
  assert.equal(read(dataRoot), "original");
});

test("deshacer retira las fotos que trajo la copia si antes no había", async () => {
  const { base, dataRoot, backups } = setup();
  const copy = await backup.copyData(dataRoot, path.join(base, "copia"));
  fs.rmSync(path.join(dataRoot, "fotos"), { recursive: true });
  const safety = await backup.restore(dataRoot, copy, backups, { pgMajor: 18 });
  assert.ok(fs.existsSync(path.join(dataRoot, "fotos")));
  assert.ok(backup.undoRestore(dataRoot, safety));
  assert.ok(!fs.existsSync(path.join(dataRoot, "fotos")), "las fotos de la copia no se quedan");
});

test("un diario ilegible (corte al escribirlo) no impide arrancar", () => {
  const { dataRoot } = setup();
  fs.writeFileSync(path.join(dataRoot, "restauracion-pendiente.json"), '{"stage": "C:/a');
  backup.recoverPendingRestore(dataRoot);
  assert.ok(!fs.existsSync(path.join(dataRoot, "restauracion-pendiente.json")));
  assert.equal(read(dataRoot), "original");
});

test("reemplazo de la copia del día cortado: se recupera la buena", async () => {
  const { dataRoot, backups } = setup();
  const today = await backup.autoBackup(dataRoot, backups, { meta: {} });
  // Corte justo después de apartar la anterior (.vieja) y antes de poner la nueva.
  fs.renameSync(today, `${today}.vieja`);
  await backup.pruneBackups(backups);
  assert.ok(backup.isBackup(today), "vuelve la copia del día");
  // Corte con la nueva ya lista (.nueva) y sin la anterior.
  fs.renameSync(today, `${today}.nueva`);
  await backup.pruneBackups(backups);
  assert.ok(backup.isBackup(today));
});

test("las copias antes-de-… se limitan a 5 de cada tipo", async () => {
  const { dataRoot, backups } = setup();
  for (let i = 0; i < 8; i++) {
    await backup.copyData(dataRoot, path.join(backups, `antes-de-actualizar-0.${i}.0-a-0.${i + 1}.0-2026-01-0${i + 1}-120000`));
    await backup.copyData(dataRoot, path.join(backups, `antes-de-restaurar-2026-01-0${i + 1}-120000`));
  }
  fs.mkdirSync(path.join(backups, "antes-de-restaurar-2026-02-01-120000.parcial"));
  await backup.pruneBackups(backups);
  const names = fs.readdirSync(backups);
  assert.equal(names.filter((n) => n.startsWith("antes-de-actualizar-")).length, 5);
  assert.equal(names.filter((n) => n.startsWith("antes-de-restaurar-")).length, 5);
  assert.ok(names.includes("antes-de-restaurar-2026-01-08-120000"), "conserva las más recientes");
  assert.ok(!names.some((n) => n.endsWith(".parcial")));
});

/** Hace fallar fs.renameSync cuando el origen es `failFrom` (error sin reintento). */
async function withFailingRename(failFrom, fn) {
  const real = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (path.resolve(from) === path.resolve(failFrom)) {
      const error = new Error(`simulado: no se pudo mover ${from}`);
      error.code = "EIO";
      throw error;
    }
    return real(from, to);
  };
  try {
    return await fn();
  } finally {
    fs.renameSync = real;
  }
}

const readConfig = (root) => JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).label;
const readPhoto = (root) => fs.readFileSync(path.join(root, "fotos", "a.webp"), "utf8");

for (const [label, item] of [
  ["el primer elemento (pgdata)", "pgdata"],
  ["el segundo elemento (config.json)", "config.json"],
  ["el último elemento (fotos)", "fotos"],
]) {
  test(`si el intercambio falla en ${label}, los datos originales quedan intactos`, async () => {
    const { base, dataRoot, backups } = setup();
    fakeData(path.join(base, "fuente"), "de la copia");
    const copy = await backup.copyData(path.join(base, "fuente"), path.join(base, "copia"));
    await withFailingRename(path.join(dataRoot, item), async () => {
      await assert.rejects(backup.restore(dataRoot, copy, backups, { pgMajor: 18 }), /simulado/);
    });
    assert.equal(read(dataRoot), "original");
    assert.equal(readConfig(dataRoot), "original");
    assert.equal(readPhoto(dataRoot), "original");
    assert.ok(!fs.existsSync(path.join(dataRoot, "restauracion-pendiente.json")), "sin diario pendiente");
    assert.ok(!fs.readdirSync(dataRoot).some((n) => n.startsWith(".restaurando-")), "sin restos");
  });
}

test("no se restaura otra copia mientras haya una restauración pendiente", async () => {
  const { base, dataRoot, backups } = setup();
  const copy = await backup.copyData(dataRoot, path.join(base, "copia"));
  fs.writeFileSync(path.join(dataRoot, "restauracion-pendiente.json"), "{}");
  await assert.rejects(backup.restore(dataRoot, copy, backups, { pgMajor: 18 }), /sin terminar/);
});

test("hasAnyBackup detecta copias completas", async () => {
  const { dataRoot, backups } = setup();
  assert.equal(backup.hasAnyBackup(backups), false);
  await backup.autoBackup(dataRoot, backups, { meta: {} });
  assert.equal(backup.hasAnyBackup(backups), true);
});

test("hasAnyBackup no da «sin copias» si la carpeta existe pero no se puede leer", () => {
  const { base } = setup();
  const notADir = path.join(base, "archivo");
  fs.writeFileSync(notADir, "x");
  assert.throws(() => backup.hasAnyBackup(notADir), /No se pudo revisar/);
});

test("Store: los datos de antes de restaurar se apartan en el disco de los datos y luego pasan a Documentos", async () => {
  const { base, dataRoot } = setup();
  const documents = path.join(base, "Documentos", "Stocko", "Copias", "PC");
  const local = path.join(dataRoot, "copias-locales");
  const copy = await backup.copyData(dataRoot, path.join(documents, "auto-2026-11-01"), { pgMajor: 18 });
  fs.writeFileSync(path.join(dataRoot, "pgdata", "base", "datos"), "cambiado después");
  const safety = await backup.restore(dataRoot, copy, documents, { pgMajor: 18, safetyDir: local });
  assert.equal(path.dirname(safety), local);
  assert.equal(read(dataRoot), "original");
  assert.equal(read(safety), "cambiado después");
  const moved = await backup.moveBackup(safety, documents);
  assert.equal(moved, path.join(documents, path.basename(safety)));
  assert.ok(backup.isBackup(moved));
  assert.equal(read(moved), "cambiado después");
  assert.ok(!fs.existsSync(safety), "el apartado local se borra al terminar de pasarlo");
  assert.ok(!fs.readdirSync(documents).some((n) => n.endsWith(".parcial")));
  // Se puede restaurar desde el apartado local (está dentro de la carpeta de datos).
  const again = await backup.copyData(dataRoot, path.join(local, "antes-de-restaurar-2026-11-02-000000"), { pgMajor: 18 });
  await backup.restore(dataRoot, again, documents, { pgMajor: 18, safetyDir: local });
});

test("empezar con datos nuevos aparta las copias: las de la base nueva no las reemplazan ni las borran", async () => {
  const { dataRoot, backups } = setup();
  assert.equal(backup.setAsideBackups(path.join(dataRoot, "no-existe"), "x"), null);
  const today = await backup.autoBackup(dataRoot, backups, { meta: {} });
  for (let day = 1; day <= 9; day++) {
    await backup.copyData(dataRoot, path.join(backups, `auto-2026-01-0${day}`));
  }
  await backup.copyData(dataRoot, path.join(backups, "antes-de-restaurar-2026-01-01-000000"));
  const kept = backup.setAsideBackups(backups, "antes-de-empezar-2026-02-01-000000");
  assert.ok(kept);
  assert.deepEqual(fs.readdirSync(backups), ["antes-de-empezar-2026-02-01-000000"]);
  assert.equal(fs.readdirSync(kept).length, 11);
  // La base nueva hace su copia del día (reemplazándola) y la limpieza corre: lo apartado sigue intacto.
  fs.writeFileSync(path.join(dataRoot, "pgdata", "base", "datos"), "base nueva");
  await backup.autoBackup(dataRoot, backups, { meta: {}, replace: true });
  assert.equal(read(today), "base nueva");
  assert.equal(read(path.join(kept, path.basename(today))), "original");
  assert.equal(fs.readdirSync(kept).length, 11);
  // Una reinstalación ve las copias apartadas aunque no haya otras.
  fs.rmSync(today, { recursive: true, force: true });
  assert.equal(backup.hasAnyBackup(backups), true);
});

test("moveBackup no borra el original si la copia no quedó igual", async () => {
  const { base, dataRoot } = setup();
  const source = await backup.copyData(dataRoot, path.join(base, "local", "antes-de-restaurar-2026-01-01-000000"));
  const original = fs.promises.cp;
  fs.promises.cp = async (from, to, options) => {
    await original(from, to, options);
    fs.rmSync(path.join(to, "fotos"), { recursive: true, force: true });
  };
  try {
    await assert.rejects(backup.moveBackup(source, path.join(base, "docs")), /incompleta/);
  } finally {
    fs.promises.cp = original;
  }
  assert.ok(backup.isBackup(source), "el original sigue ahí");
});

test("la copia del día se hace aunque no se pueda limpiar una vieja (p. ej. OneDrive la bloquea)", async () => {
  const { dataRoot, backups } = setup();
  fs.mkdirSync(path.join(backups, "auto-2020-01-01.parcial"), { recursive: true });
  const original = fs.promises.rm;
  fs.promises.rm = async (target, options) => {
    if (String(target).includes("auto-2020-01-01")) throw Object.assign(new Error("bloqueado"), { code: "EBUSY" });
    return original(target, options);
  };
  try {
    const created = await backup.autoBackup(dataRoot, backups, { meta: {} });
    assert.ok(created && backup.isBackup(created));
  } finally {
    fs.promises.rm = original;
  }
});
