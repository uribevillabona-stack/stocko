"use strict";
// Pruebas de las actualizaciones (sin Electron ni internet: todo simulado).
// Ejecutar: node --test desktop/test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const updates = require("../lib/updates.cjs");

test("installKind distingue Store, desarrollo, instalador y portable", () => {
  const exePath = path.join("C:", "Programas", "Stocko", "Stocko.exe");
  const withUninstaller = (file) => file.endsWith("Uninstall Stocko.exe");
  assert.equal(updates.installKind({ isStore: true, isPackaged: true, exePath, exists: withUninstaller }), "store");
  assert.equal(updates.installKind({ isStore: false, isPackaged: false, exePath, exists: withUninstaller }), "dev");
  assert.equal(updates.installKind({ isStore: false, isPackaged: true, exePath, exists: withUninstaller }), "installed");
  assert.equal(updates.installKind({ isStore: false, isPackaged: true, exePath, exists: () => false }), "portable");
});

test("compareVersions compara por números, no por texto", () => {
  assert.equal(updates.compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(updates.compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(updates.compareVersions("0.1.9", "0.2.0"), -1);
  assert.equal(updates.compareVersions("1.0", "1.0.0"), 0);
  assert.equal(updates.compareVersions("1.0.0-beta.1", "1.0.0"), 0);
});

test("attemptOutcome: sin intento, instalado, en curso o fallido", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
  assert.equal(updates.attemptOutcome(null, "0.2.0", now), "none");
  assert.equal(updates.attemptOutcome({}, "0.2.0", now), "none");
  assert.equal(updates.attemptOutcome({ version: "0.2.0", at: at(1) }, "0.2.0", now), "done");
  assert.equal(updates.attemptOutcome({ version: "0.2.0", at: at(1) }, "0.3.0", now), "done");
  assert.equal(updates.attemptOutcome({ version: "0.3.0", at: at(2) }, "0.2.0", now), "pending");
  assert.equal(updates.attemptOutcome({ version: "0.3.0", at: at(11) }, "0.2.0", now), "failed");
  assert.equal(updates.attemptOutcome({ version: "0.3.0" }, "0.2.0", now), "failed", "sin fecha no se espera");
});

test("el instalador se abre con ventana (nunca en silencio)", () => {
  assert.deepEqual(updates.INSTALLER_ARGS, ["--updated"]);
});

test("testFeedUrl: solo acepta un servidor de este mismo PC", () => {
  assert.equal(updates.testFeedUrl("http://127.0.0.1:48999"), "http://127.0.0.1:48999");
  assert.equal(updates.testFeedUrl("http://127.0.0.1:48999/carpeta"), "http://127.0.0.1:48999/carpeta");
  assert.equal(updates.testFeedUrl("https://ejemplo.com/actualizaciones"), null);
  assert.equal(updates.testFeedUrl("http://127.0.0.1.ejemplo.com"), null);
  assert.equal(updates.testFeedUrl("http://127.0.0.1:1@ejemplo.com"), null);
  assert.equal(updates.testFeedUrl(undefined), null);
});

const INSTALLER = "C:\\cache\\Stocko-Instalador.exe";
const longAgo = "2026-01-01T00:00:00.000Z";

/** Arma un actualizador con todo simulado. `answers`: respuestas de los avisos, en orden. */
function harness({
  kind = "installed",
  state = {},
  answers = [],
  available = "0.3.0",
  checkError = null,
  launchError = null,
  prompt = true,
  files = [INSTALLER],
} = {}) {
  const calls = { boxes: [], opened: [], launched: [], status: [], quit: 0, downloads: 0, checks: 0 };
  const store = { ...state };
  const env = { prompt };
  const autoUpdater = Object.assign(new EventEmitter(), {
    async checkForUpdates() {
      calls.checks++;
      if (checkError) throw checkError;
      return available
        ? { isUpdateAvailable: true, updateInfo: { version: available, files: [{ size: 150 * 1024 * 1024 }] } }
        : { isUpdateAvailable: false, updateInfo: { version: "0.2.0" } };
    },
    async downloadUpdate() {
      calls.downloads++;
      return [INSTALLER];
    },
  });
  const updater = updates.create({
    app: { getVersion: () => "0.2.0" },
    dialog: {
      async showMessageBox(_win, box) {
        calls.boxes.push(box);
        return answers.shift() ?? { response: box.cancelId ?? 0, checkboxChecked: false };
      },
    },
    shell: { openExternal: async (url) => void calls.opened.push(url) },
    kind,
    log: () => {},
    readState: () => store,
    updateState: (patch) => Object.assign(store, patch),
    getWindow: () => ({ isDestroyed: () => false, setProgressBar: () => {} }),
    canPrompt: () => env.prompt,
    quit: () => void calls.quit++,
    autoUpdater,
    exists: (file) => files.includes(file),
    launch: async (file, args) => {
      if (launchError) throw launchError;
      calls.launched.push({ file, args });
    },
  });
  return { updater, calls, store, env };
}
const clean = async () => true;
const status = (calls) => (message) => void calls.status.push(message);

test("Store y desarrollo: no buscan ni instalan nada", async () => {
  for (const kind of ["store", "dev"]) {
    const { updater, calls } = harness({ kind, state: { updateReady: { version: "0.3.0", file: INSTALLER } } });
    assert.equal(updater.active, false);
    await updater.checkNow();
    await updater.installOnQuit({ clean });
    assert.equal(await updater.installAtStartup(status(calls)), false);
    assert.equal(calls.checks, 0);
    assert.equal(calls.boxes.length, 0);
    assert.equal(calls.launched.length, 0);
  }
});

test("instalador: «Actualizar ahora» instala cuando Stocko terminó de cerrar bien", async () => {
  const { updater, calls, store } = harness({ answers: [{ response: 0 }, { response: 0 }] });
  await updater.checkNow();
  assert.equal(calls.downloads, 1);
  assert.equal(calls.quit, 1, "pide cerrar por el camino normal");
  assert.equal(calls.launched.length, 0, "no instala antes de que Stocko termine de cerrar");
  await updater.installOnQuit({ clean });
  assert.deepEqual(calls.launched, [{ file: INSTALLER, args: ["--updated"] }]);
  assert.equal(store.updateAttempt.version, "0.3.0");
  assert.equal(store.updateAttempt.from, "0.2.0");
  assert.equal(store.updateReady, null, "no queda pendiente: no se relanza en el próximo arranque");
});

test("instalador: si la base no cerró bien, no instala y queda para el próximo arranque", async () => {
  const { updater, calls, store } = harness({ answers: [{ response: 0 }, { response: 0 }] });
  await updater.checkNow();
  await updater.installOnQuit({ clean: async () => false });
  assert.equal(calls.launched.length, 0);
  assert.equal(store.updateReady.version, "0.3.0");
  assert.equal(store.updateAttempt, undefined);
});

test("instalador: «La próxima vez que abra Stocko» no instala al cerrar", async () => {
  const { updater, calls, store } = harness({ answers: [{ response: 0 }, { response: 1 }] });
  await updater.checkNow();
  assert.equal(calls.quit, 0);
  await updater.installOnQuit({ clean });
  assert.equal(calls.launched.length, 0, "cerrar Stocko nunca instala por su cuenta");
  assert.deepEqual(store.updateReady, { version: "0.3.0", file: INSTALLER });
});

test("al abrir: instala lo que quedó descargado, antes de arrancar la base, y una sola vez", async () => {
  const { updater, calls, store } = harness({ state: { updateReady: { version: "0.3.0", file: INSTALLER } } });
  assert.equal(await updater.installAtStartup(status(calls)), true);
  assert.deepEqual(calls.launched, [{ file: INSTALLER, args: ["--updated"] }]);
  assert.match(calls.status[0], /Instalando la versión 0\.3\.0/);
  assert.equal(store.updateReady, null);
  assert.equal(await updater.installAtStartup(status(calls)), false, "si no quedó puesta, no entra en bucle");
  assert.equal(calls.launched.length, 1);
});

test("al abrir: descarta lo descargado si ya no sirve (archivo borrado o versión ya instalada)", async () => {
  const gone = harness({ state: { updateReady: { version: "0.3.0", file: INSTALLER } }, files: [] });
  assert.equal(await gone.updater.installAtStartup(status(gone.calls)), false);
  assert.equal(gone.store.updateReady, null);
  const old = harness({ state: { updateReady: { version: "0.2.0", file: INSTALLER } } });
  assert.equal(await old.updater.installAtStartup(status(old.calls)), false);
  assert.equal(old.calls.launched.length, 0);
});

test("portable: nunca instala al abrir aunque haya algo descargado", async () => {
  const { updater, calls } = harness({ kind: "portable", state: { updateReady: { version: "0.3.0", file: INSTALLER } } });
  assert.equal(await updater.installAtStartup(status(calls)), false);
  assert.equal(calls.launched.length, 0);
});

test("con algo ya descargado, buscar vuelve a ofrecer instalar sin descargar otra vez", async () => {
  const { updater, calls } = harness({ state: { updateReady: { version: "0.3.0", file: INSTALLER } }, answers: [{ response: 1 }] });
  await updater.checkNow();
  assert.equal(calls.checks, 0);
  assert.equal(calls.downloads, 0);
  assert.match(calls.boxes[0].message, /lista para instalar/);
});

test("la descarga pedida avisa al terminar aunque Stocko no esté en la pantalla normal", async () => {
  const { updater, calls, env } = harness({ answers: [{ response: 0 }, { response: 1 }] });
  env.prompt = false;
  await updater.checkNow();
  assert.equal(calls.boxes.length, 2);
  assert.match(calls.boxes[1].message, /lista para instalar/);
});

test("instalador: «Ahora no» no descarga; la casilla deja de avisar de esa versión", async () => {
  const { updater, calls, store } = harness({ answers: [{ response: 1, checkboxChecked: true }] });
  await updater._tick();
  assert.equal(calls.downloads, 0);
  assert.equal(store.updateSkipped, "0.3.0");
  await updater._tick();
  assert.equal(calls.boxes.length, 1, "la búsqueda automática ya no pregunta");
  await updater.checkNow();
  assert.equal(calls.boxes.length, 2, "la búsqueda a mano sí");
  assert.equal(calls.boxes[1].checkboxLabel, undefined);
});

test("búsqueda automática apagada: no se conecta", async () => {
  const { updater, calls } = harness({ state: { updateAuto: false } });
  assert.equal(updater.autoEnabled(), false);
  await updater._tick();
  assert.equal(calls.checks, 0);
});

test("búsqueda automática: no interrumpe si Stocko no está en uso normal", async () => {
  const { updater, calls } = harness({ prompt: false });
  await updater._tick();
  assert.equal(calls.checks, 0);
  assert.equal(calls.boxes.length, 0);
});

test("sin internet: la automática calla y la manual lo explica", async () => {
  const { updater, calls } = harness({ checkError: new Error("net::ERR_INTERNET_DISCONNECTED") });
  await updater._tick();
  assert.equal(calls.boxes.length, 0);
  await updater.checkNow();
  assert.equal(calls.boxes.length, 1);
  assert.equal(calls.boxes[0].type, "error");
});

test("al día: solo la búsqueda manual lo confirma", async () => {
  const { updater, calls } = harness({ available: null });
  await updater._tick();
  assert.equal(calls.boxes.length, 0);
  await updater.checkNow();
  assert.match(calls.boxes[0].message, /versión más reciente/);
});

test("portable: avisa y abre la página de descargas, nunca descarga", async () => {
  const { updater, calls } = harness({ kind: "portable", answers: [{ response: 0 }] });
  await updater.checkNow();
  assert.equal(calls.downloads, 0);
  assert.deepEqual(calls.opened, [updates.RELEASES_URL]);
  await updater.installOnQuit({ clean });
  assert.equal(calls.launched.length, 0);
});

test("Windows bloquea el instalador: lo dice y la próxima vez ofrece la descarga a mano", async () => {
  const blocked = Object.assign(new Error("spawn UNKNOWN"), { code: "UNKNOWN" });
  const { updater, calls, store } = harness({ answers: [{ response: 0 }, { response: 0 }, { response: 1 }], launchError: blocked });
  await updater.checkNow();
  await updater.installOnQuit({ clean });
  assert.equal(store.updateFailed, "0.3.0");
  assert.equal(store.updateAttempt, null);
  assert.equal(store.updateReady, null);
  assert.match(calls.boxes.at(-1).message, /Windows no dejó abrir el instalador/);
  await updater.checkNow();
  assert.equal(calls.downloads, 1, "no vuelve a descargar el instalador bloqueado");
  assert.match(calls.boxes.at(-1).detail, /versión portable/);
});

test("al abrir con el instalador bloqueado: lo dice y Stocko sigue abriendo", async () => {
  const blocked = Object.assign(new Error("spawn UNKNOWN"), { code: "UNKNOWN" });
  const { updater, calls, store } = harness({ state: { updateReady: { version: "0.3.0", file: INSTALLER } }, launchError: blocked });
  assert.equal(await updater.installAtStartup(status(calls)), false);
  assert.equal(store.updateFailed, "0.3.0");
  assert.equal(calls.boxes.length, 1);
});

test("al abrir: avisa una vez si la última instalación no quedó puesta", async () => {
  const { updater, calls, store } = harness({ state: { updateAttempt: { version: "0.3.0", at: longAgo }, updateAuto: false } });
  await updater._tick();
  assert.equal(calls.boxes.length, 1);
  assert.match(calls.boxes[0].message, /no quedó instalada/);
  assert.equal(store.updateAttempt, null);
  assert.equal(store.updateFailed, "0.3.0");
  await updater._tick();
  assert.equal(calls.boxes.length, 1);
});

test("al abrir mientras el instalador sigue trabajando: ni avisa de fallo ni busca", async () => {
  const { updater, calls, store } = harness({ state: { updateAttempt: { version: "0.3.0", at: new Date().toISOString() } } });
  await updater._tick();
  assert.equal(calls.boxes.length, 0);
  assert.equal(calls.checks, 0);
  assert.equal(store.updateAttempt.version, "0.3.0");
  assert.equal(store.updateFailed, undefined);
});

test("al abrir: si la instalación quedó puesta, limpia las marcas sin avisos", async () => {
  const { updater, calls, store } = harness({
    state: { updateAttempt: { version: "0.2.0", at: longAgo }, updateSkipped: "0.2.0", updateFailed: "0.1.5", updateAuto: false },
  });
  await updater._tick();
  assert.equal(calls.boxes.length, 0);
  assert.equal(store.updateAttempt, null);
  assert.equal(store.updateFailed, null);
  assert.equal(store.updateSkipped, null);
});
