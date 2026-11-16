const { createHash } = require("node:crypto");
const { cpSync, existsSync, readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { stageDir, distDir } = require("./paths.cjs");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "co.stocko.desktop",
  productName: "Stocko",
  copyright: "Stocko",
  directories: { output: distDir, buildResources: "build" },
  files: ["main.cjs", "paths.cjs", "lib/**/*", "build/icon.png", "package.json"],
  // Servidor de Next, binarios de Postgres y migraciones: archivos reales en disco
  // (no dentro de app.asar) porque se ejecutan como procesos aparte.
  extraResources: [
    { from: join(stageDir, "server"), to: "server", filter: ["**/*"] },
    { from: join(stageDir, "pgsql"), to: "pgsql", filter: ["**/*"] },
    { from: join(stageDir, "drizzle"), to: "drizzle", filter: ["**/*"] },
    { from: join(stageDir, "stocko.ico"), to: "stocko.ico" },
  ],
  // electron-builder descarta siempre las carpetas node_modules de extraResources;
  // el servidor las necesita, así que se copian aquí (antes de armar el instalador).
  afterPack: async ({ appOutDir }) => {
    const copyModules = (from, to) => {
      for (const name of readdirSync(from, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        const src = join(from, name.name);
        const dest = join(to, name.name);
        if (name.name === "node_modules") cpSync(src, dest, { recursive: true });
        else copyModules(src, dest);
      }
    };
    const server = join(appOutDir, "resources", "server");
    copyModules(join(stageDir, "server"), server);
    for (const required of ["node_modules/next/package.json", "node_modules/@img/sharp-win32-x64/lib/libvips-42.dll"]) {
      if (!existsSync(join(server, required))) throw new Error(`Falta ${required} en el paquete`);
    }
    // Stocko.exe debe ser idéntico al electron.exe original (ver signAndEditExecutable).
    const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
    const original = join(__dirname, "node_modules", "electron", "dist", "electron.exe");
    if (hash(join(appOutDir, "Stocko.exe")) !== hash(original)) {
      throw new Error("Stocko.exe fue modificado: Smart App Control lo bloquearía");
    }
  },
  asar: true,
  // Sin el dato de integridad incrustado en Stocko.exe (lo modificaría; ver win.signAndEditExecutable).
  // Electron solo lo usa con el fuse EnableEmbeddedAsarIntegrityValidation, que aquí está apagado.
  disableAsarIntegrity: true,
  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "zip", arch: ["x64"] },
    ],
    artifactName: "Stocko-${version}-portable.${ext}",
    icon: "build/icon.png",
    // Smart App Control (Windows 11) bloquea ejecutables sin firma que no conoce.
    // El electron.exe original es conocido (lo usan millones de equipos) y pasa;
    // si electron-builder le cambia el ícono y los datos, se vuelve "nuevo" en cada
    // compilación y Windows lo bloquea. Por eso Stocko.exe queda sin modificar y el
    // ícono de Stocko va en los accesos directos (build/installer.nsh y main.cjs).
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Stocko",
    installerLanguages: ["es_ES"],
    language: "3082",
    // Los datos del negocio (%LOCALAPPDATA%\Stocko) nunca se borran al desinstalar.
    deleteAppDataOnUninstall: false,
    artifactName: "Stocko-Instalador-${version}.exe",
  },
};
