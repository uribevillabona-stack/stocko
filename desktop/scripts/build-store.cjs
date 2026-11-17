"use strict";
// Paquete MSIX para la Microsoft Store. La Store lo firma al publicarlo.
//
// Identidad: Partner Center → la app → "Identidad del producto". Se pasa por
// variables de entorno (sin ellas se usa una identidad de prueba, solo para
// probar en este PC):
//   STOCKO_STORE_IDENTITY        Package/Identity/Name
//   STOCKO_STORE_PUBLISHER       Package/Identity/Publisher (CN=...)
//   STOCKO_STORE_PUBLISHER_NAME  Package/Properties/PublisherDisplayName
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { Arch, Platform, build } = require("electron-builder");
const config = require("../electron-builder.config.cjs");

//   STOCKO_STORE_DISPLAY_NAME    nombre reservado en Partner Center (por defecto "Stocko")
// Con --release faltar cualquiera de las tres primeras es un error (paquete para enviar).
const REQUIRED = ["STOCKO_STORE_IDENTITY", "STOCKO_STORE_PUBLISHER", "STOCKO_STORE_PUBLISHER_NAME"];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (process.argv.includes("--release") && missing.length > 0) {
  console.error(`Faltan ${missing.join(", ")} (Partner Center → Identidad del producto).`);
  process.exit(1);
}
if (missing.length > 0) {
  console.warn(`Sin ${missing.join(", ")}: paquete de PRUEBA (no sirve para enviar a la Store).`);
}

execFileSync(process.execPath, [path.join(__dirname, "store-assets.mjs")], { stdio: "inherit" });

const identity = {
  identityName: process.env.STOCKO_STORE_IDENTITY || "StockoPrueba.Stocko",
  publisher: process.env.STOCKO_STORE_PUBLISHER || "CN=Stocko Prueba",
  publisherDisplayName: process.env.STOCKO_STORE_PUBLISHER_NAME || "Stocko",
};

build({
  projectDir: path.join(__dirname, ".."),
  targets: Platform.WINDOWS.createTarget("appx", Arch.x64),
  publish: "never",
  config: {
    ...config,
    appx: {
      ...identity,
      applicationId: "Stocko",
      displayName: process.env.STOCKO_STORE_DISPLAY_NAME || "Stocko",
      languages: ["es-CO", "es-ES"],
      backgroundColor: "#F6F5F2",
      showNameOnTiles: false,
      artifactName: "Stocko-${version}-store.${ext}",
    },
  },
})
  .then((files) => {
    for (const file of files) console.log(`Listo: ${file}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
