"use strict";
// Genera el instalador de Windows (NSIS).
//
// electron-builder crea el desinstalador ejecutando un instalador intermedio sin
// firma. En PCs con Smart App Control activo (Windows 11), Windows bloquea ese
// ejecutable nuevo ("spawn UNKNOWN"). electron-builder ya sabe extraer el
// desinstalador leyendo el archivo, sin ejecutarlo (lo usa en macOS); aquí se
// activa esa ruta. Es la única comprobación que usa esa marca (NsisTarget.js).
const macosVersion = require("app-builder-lib/out/util/macosVersion");
macosVersion.isMacOsCatalina = () => true;

const { Arch, Platform, build } = require("electron-builder");
const config = require("../electron-builder.config.cjs");

build({
  projectDir: require("node:path").join(__dirname, ".."),
  // Instalador + versión portable (ZIP: se descomprime y se abre Stocko.exe).
  // La portable sirve donde Smart App Control bloquea el instalador sin firma.
  targets: Platform.WINDOWS.createTarget(["nsis", "zip"], Arch.x64),
  config,
})
  .then((files) => {
    for (const file of files) console.log(`Listo: ${file}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
