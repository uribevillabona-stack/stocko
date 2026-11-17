"use strict";
// Actualizaciones de Stocko para Windows.
//   - Instalador: busca la versión nueva en GitHub y la descarga si la persona acepta.
//     Se instala con la ventana del instalador a la vista y con la persona presente:
//     «Actualizar ahora» (Stocko cierra bien y después arranca el instalador) o al
//     volver a abrir Stocko. Nunca en silencio al cerrar: el instalador empieza quitando
//     los archivos del programa y, si alguien apaga el PC enseguida, Stocko no abriría más.
//   - Portable: solo avisa (se actualiza reemplazando la carpeta).
//   - Microsoft Store: nada; la Store actualiza sola.
// Es lo único que Stocko para Windows pide por internet por su cuenta. Se apaga en
// Ayuda → "Buscar actualizaciones al abrir" (ver legal/privacidad.md).
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// La misma dirección está en src/lib/project.ts (la app web): cámbialas juntas.
const REPO_URL = "https://github.com/uribevillabona-stack/stocko";
const RELEASES_URL = `${REPO_URL}/releases/latest`;
const UNINSTALLER = "Uninstall Stocko.exe";

const FIRST_CHECK_MS = 20_000;
const RETRY_MS = 60_000;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
// Lo que puede tardar el instalador: mientras tanto no se concluye que falló.
const INSTALL_GRACE_MS = 10 * 60 * 1000;
// Con ventana (sin /S): se ve el avance y, al terminar, el instalador ofrece abrir Stocko.
const INSTALLER_ARGS = ["--updated"];

/** "store" | "dev" | "installed" | "portable" */
function installKind({ isStore, isPackaged, exePath, exists = fs.existsSync }) {
  if (isStore) return "store";
  if (!isPackaged) return "dev";
  // El instalador deja su desinstalador junto a Stocko.exe; el ZIP portable no lo trae.
  return exists(path.join(path.dirname(exePath), UNINSTALLER)) ? "installed" : "portable";
}

/** Compara "1.2.3" con "1.10.0" por números (ignora sufijos como -beta). */
function compareVersions(a, b) {
  const parts = (value) =>
    String(value)
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Qué pasó con la última instalación que se lanzó: "none" | "done" | "pending" | "failed". */
function attemptOutcome(attempt, currentVersion, now = Date.now()) {
  if (!attempt || !attempt.version) return "none";
  if (compareVersions(currentVersion, attempt.version) >= 0) return "done";
  // Stocko se abrió mientras el instalador todavía trabaja: aún no se sabe.
  const age = now - Date.parse(attempt.at);
  return age >= 0 && age < INSTALL_GRACE_MS ? "pending" : "failed";
}

/** Solo pruebas en este mismo PC: la fuente de actualizaciones no se puede desviar hacia fuera. */
function testFeedUrl(value) {
  return typeof value === "string" && /^http:\/\/127\.0\.0\.1(:\d+)?(\/.*)?$/.test(value) ? value : null;
}

function megabytes(bytes) {
  return Math.max(1, Math.round(bytes / 1024 / 1024));
}

function spawnDetached(file, args) {
  return new Promise((resolve, reject) => {
    // Fuera de la carpeta del programa, para que el instalador pueda reemplazarla.
    const child = spawn(file, args, { cwd: path.dirname(file), detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * @param {object} deps
 * @param {"store"|"dev"|"installed"|"portable"} deps.kind
 * @param {() => boolean} deps.canPrompt  Stocko está en uso normal: un aviso automático no estorba.
 * @param {() => void} deps.quit          Cierra Stocko por el camino normal (copia + base detenida).
 * @param {object} [deps.autoUpdater]     Solo pruebas; por defecto el de electron-updater.
 * @param {Function} [deps.launch]        Solo pruebas; por defecto abre el instalador.
 * @param {Function} [deps.exists]        Solo pruebas; por defecto fs.existsSync.
 */
function create({ app, dialog, shell, kind, log, readState, updateState, getWindow, canPrompt, quit, autoUpdater, launch = spawnDetached, exists = fs.existsSync }) {
  const active = kind === "installed" || kind === "portable";
  let updater = autoUpdater ?? null;
  let busy = false;
  let timer = null;
  let reported = false;
  /** La persona eligió «Actualizar ahora»: se instala al terminar de cerrar. */
  let installNow = false;

  function engine() {
    if (updater) return updater;
    updater = require("electron-updater").autoUpdater;
    updater.autoDownload = false;
    // La instalación la lanza este módulo (launchInstaller), nunca electron-updater.
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    // electron-updater manda por defecto un identificador fijo de la instalación (sirve para
    // repartir versiones por etapas). Stocko no lo usa: se envía vacío.
    updater.requestHeaders = { "x-user-staging-id": "" };
    updater.logger = {
      info: (message) => log(`actualización: ${message}`),
      warn: (message) => log(`actualización (aviso): ${message}`),
      error: (message) => log(`actualización (error): ${message}`),
    };
    // Pruebas: un servidor de este mismo PC con latest.yml y el instalador (en vez de GitHub).
    const testFeed = testFeedUrl(process.env.STOCKO_UPDATE_URL);
    if (testFeed) updater.setFeedURL({ provider: "generic", url: testFeed, requestHeaders: updater.requestHeaders });
    return updater;
  }

  const window = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  };
  const show = (options) => {
    const win = window();
    const box = { title: "Actualización de Stocko", noLink: true, ...options };
    return win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box);
  };
  const openDownloads = () => void shell.openExternal(RELEASES_URL);
  const autoEnabled = () => readState().updateAuto !== false;
  const MANUAL_HELP =
    "Puedes descargar la versión nueva desde la página de Stocko. Si Windows tampoco deja abrir ese instalador, " +
    "usa la versión portable (el archivo ZIP): tus datos son los mismos.";

  /** Instalador ya descargado y verificado, pendiente de instalar: { version, file } o null. */
  function ready() {
    const pending = readState().updateReady;
    if (!pending || !pending.version || !pending.file) return null;
    if (compareVersions(pending.version, app.getVersion()) > 0 && exists(pending.file)) return pending;
    updateState({ updateReady: null });
    return null;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = null;
    if (!active) return;
    timer = setTimeout(() => void tick(), ms);
    timer.unref?.();
  }

  async function tick() {
    if (!canPrompt()) {
      schedule(RETRY_MS);
      return;
    }
    if (attemptOutcome(readState().updateAttempt, app.getVersion()) === "pending") {
      schedule(INSTALL_GRACE_MS);
      return;
    }
    if (!reported) {
      reported = true;
      await reportLastAttempt().catch((error) => log(`actualización: ${error.stack || error}`));
    }
    if (!autoEnabled()) return;
    schedule(CHECK_EVERY_MS);
    await check({ manual: false });
  }

  /** Al abrir: ¿la instalación que se lanzó la última vez quedó puesta? */
  async function reportLastAttempt() {
    const attempt = readState().updateAttempt;
    const outcome = attemptOutcome(attempt, app.getVersion());
    if (outcome === "none" || outcome === "pending") return;
    if (outcome === "done") {
      log(`actualización: Stocko quedó en la versión ${app.getVersion()}`);
      updateState({ updateAttempt: null, updateFailed: null, updateSkipped: null });
      return;
    }
    // No se vuelve a intentar sola con el instalador: se ofrece la descarga a mano.
    log(`actualización: la versión ${attempt.version} no quedó instalada`);
    updateState({ updateAttempt: null, updateFailed: attempt.version });
    const answer = await show({
      type: "warning",
      message: `La actualización a la versión ${attempt.version} no quedó instalada.`,
      detail:
        "Es posible que Windows haya bloqueado el instalador (pasa en equipos con Smart App Control, " +
        `porque Stocko todavía no tiene firma digital). Tus datos están intactos.\n\n${MANUAL_HELP}`,
      buttons: ["Abrir la página de descargas", "Cerrar"],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response === 0) openDownloads();
  }

  async function check({ manual }) {
    if (!active) return;
    if (busy) {
      if (manual) await show({ type: "info", message: "Stocko ya está buscando o descargando una actualización.", buttons: ["Entendido"] });
      return;
    }
    busy = true;
    try {
      if (ready()) {
        await promptInstall({ manual });
        return;
      }
      let result;
      try {
        result = await engine().checkForUpdates();
      } catch (error) {
        log(`actualización: no se pudo buscar: ${error.stack || error}`);
        if (manual) {
          await show({
            type: "error",
            message: "No se pudo buscar actualizaciones.",
            detail: "Revisa tu conexión a internet e inténtalo de nuevo. Stocko sigue funcionando normal sin internet.",
            buttons: ["Entendido"],
          });
        }
        return;
      }
      const version = result?.updateInfo?.version;
      if (!result?.isUpdateAvailable || !version) {
        if (manual) await show({ type: "info", message: `Ya tienes la versión más reciente de Stocko (${app.getVersion()}).`, buttons: ["Entendido"] });
        return;
      }
      if (!manual && !canPrompt()) return;
      const state = readState();
      if (!manual && state.updateSkipped === version) return;
      if (kind === "portable" || state.updateFailed === version) await promptManual(version, { manual });
      else await promptDownload(version, result.updateInfo, { manual });
    } finally {
      busy = false;
    }
  }

  const skipBox = (manual) => (manual ? {} : { checkboxLabel: "No avisarme más de esta versión" });
  const rememberSkip = (answer, version) => {
    if (answer.checkboxChecked) updateState({ updateSkipped: version });
  };

  /** Portable (o instalador que Windows bloqueó): la descarga la hace la persona. */
  async function promptManual(version, { manual }) {
    const answer = await show({
      type: "info",
      message: `Hay una versión nueva de Stocko: la ${version}.`,
      detail:
        kind === "portable"
          ? `Tienes la ${app.getVersion()} portable. Para actualizar: descarga el ZIP nuevo, cierra Stocko y reemplaza la carpeta del programa. ` +
            "Tus datos no están en esa carpeta, así que no se pierden."
          : `Tienes la ${app.getVersion()}. La instalación automática de esta versión no funcionó en este equipo. ${MANUAL_HELP}`,
      buttons: ["Abrir la página de descargas", "Ahora no"],
      defaultId: 0,
      cancelId: 1,
      ...skipBox(manual),
    });
    if (answer.response === 0) openDownloads();
    else rememberSkip(answer, version);
  }

  async function promptDownload(version, info, { manual }) {
    const size = info.files?.[0]?.size;
    const answer = await show({
      type: "info",
      message: `Hay una versión nueva de Stocko: la ${version}.`,
      detail:
        `Tienes la ${app.getVersion()}.${size ? ` La descarga pesa hasta ${megabytes(size)} MB.` : ""} ` +
        "Puedes seguir trabajando mientras se descarga.\n\n" +
        "Tus datos no se tocan y, antes de actualizar, Stocko guarda una copia de seguridad.",
      buttons: ["Descargar", "Ahora no"],
      defaultId: 0,
      cancelId: 1,
      ...skipBox(manual),
    });
    if (answer.response !== 0) {
      rememberSkip(answer, version);
      return;
    }
    const onProgress = (progress) => window()?.setProgressBar(Math.min(1, Math.max(0.02, (progress.percent || 0) / 100)));
    engine().on("download-progress", onProgress);
    try {
      const files = await engine().downloadUpdate();
      if (!files || !files[0]) throw new Error("La descarga terminó sin archivo.");
      updateState({ updateReady: { version, file: files[0] } });
      log(`actualización: versión ${version} descargada en ${files[0]}`);
    } catch (error) {
      log(`actualización: la descarga falló: ${error.stack || error}`);
      const failed = await show({
        type: "error",
        message: "No se pudo descargar la actualización.",
        detail: "Revisa tu conexión a internet. Puedes intentarlo otra vez en Ayuda → Buscar actualizaciones, o descargarla tú desde la página de Stocko.",
        buttons: ["Entendido", "Abrir la página de descargas"],
        defaultId: 0,
        cancelId: 0,
      });
      if (failed.response === 1) openDownloads();
      return;
    } finally {
      engine().removeListener("download-progress", onProgress);
      window()?.setProgressBar(-1);
    }
    // La persona pidió la descarga: se le avisa que terminó aunque Stocko esté en otra pantalla.
    await promptInstall({ manual: true });
  }

  async function promptInstall({ manual }) {
    const pending = ready();
    // Un aviso automático no interrumpe si Stocko no está en uso normal: queda para el próximo arranque.
    if (!pending || (!manual && !canPrompt())) return;
    const answer = await show({
      type: "info",
      message: `La versión ${pending.version} está lista para instalar.`,
      detail:
        "Stocko se cierra y aparece la ventana del instalador. Cuando termine, ciérrala y Stocko vuelve a abrirse. " +
        "Tarda uno o dos minutos: no apagues el computador mientras tanto.\n\n" +
        "Si ahora no puedes, se instala la próxima vez que abras Stocko.",
      buttons: ["Actualizar ahora", "La próxima vez que abra Stocko"],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response === 0) {
      installNow = true;
      quit();
    }
  }

  /** Abre el instalador descargado. Si Windows no deja, lo dice y no se reintenta solo. */
  async function launchInstaller(pending) {
    const { version, file } = pending;
    // Se anota antes: si no queda instalada, el próximo arranque lo avisa (y no entra en bucle).
    updateState({ updateReady: null, updateAttempt: { version, from: app.getVersion(), at: new Date().toISOString() } });
    try {
      await launch(file, INSTALLER_ARGS);
      log(`actualización: instalador de la versión ${version} lanzado`);
      return true;
    } catch (error) {
      log(`actualización: no se pudo abrir el instalador: ${error.stack || error}`);
      updateState({ updateAttempt: null, updateFailed: version });
      const answer = await show({
        type: "warning",
        message: `Windows no dejó abrir el instalador de la versión ${version}.`,
        detail:
          "Pasa en equipos con Smart App Control, porque Stocko todavía no tiene firma digital. Tus datos están intactos y " +
          `Stocko sigue en la versión de antes.\n\n${MANUAL_HELP}`,
        buttons: ["Abrir la página de descargas", "Cerrar"],
        defaultId: 0,
        cancelId: 1,
      });
      if (answer.response === 0) openDownloads();
      return false;
    }
  }

  /**
   * Último paso al cerrar Stocko. Solo instala si la persona eligió «Actualizar ahora»
   * y el cierre fue limpio (`clean()`: base detenida). Si no, queda para el próximo arranque.
   */
  async function installOnQuit({ clean }) {
    clearTimeout(timer);
    if (!installNow) return;
    installNow = false;
    const pending = ready();
    if (!pending) return;
    if (!(await clean())) {
      log("actualización: Stocko no cerró limpio; la instalación queda para la próxima vez que se abra");
      return;
    }
    await launchInstaller(pending);
  }

  /**
   * Al abrir, antes de arrancar la base: instala lo que quedó descargado.
   * Devuelve true si el instalador quedó en marcha (Stocko debe cerrarse ya).
   */
  async function installAtStartup(status) {
    if (kind !== "installed") return false;
    const pending = ready();
    if (!pending) return false;
    status(`Instalando la versión ${pending.version} de Stocko…`);
    return launchInstaller(pending);
  }

  return {
    active,
    autoEnabled,
    /** Empieza a revisar (un rato después de abrir y luego una vez al día). */
    start: () => schedule(FIRST_CHECK_MS),
    checkNow: () => check({ manual: true }),
    setAuto(enabled) {
      updateState({ updateAuto: Boolean(enabled) });
      if (enabled) schedule(FIRST_CHECK_MS);
    },
    installOnQuit,
    installAtStartup,
    /** Solo pruebas. */
    _tick: tick,
  };
}

module.exports = { REPO_URL, RELEASES_URL, INSTALLER_ARGS, installKind, compareVersions, attemptOutcome, testFeedUrl, create };
