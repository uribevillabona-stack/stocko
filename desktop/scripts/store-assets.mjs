// Logos del paquete MSIX (Microsoft Store), generados desde el ícono de la PWA.
// electron-builder los toma de desktop/build/appx/.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(desktopDir, "..");
const require = createRequire(import.meta.url);
const sharp = require(join(root, "node_modules", "sharp"));

const source = join(root, "public", "icons", "icon-512.png");
const out = join(desktopDir, "build", "appx");
mkdirSync(out, { recursive: true });

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

/** Ícono centrado en un lienzo transparente de ancho × alto, ocupando `scale` del lado menor. */
async function logo(name, width, height, scale) {
  const side = Math.round(Math.min(width, height) * scale);
  const icon = await sharp(source).resize(side, side).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: transparent } })
    .composite([{ input: icon, gravity: "center" }])
    .png()
    .toFile(join(out, name));
}

await logo("StoreLogo.png", 50, 50, 1);
await logo("Square44x44Logo.png", 44, 44, 1);
await logo("Square150x150Logo.png", 150, 150, 0.66);
await logo("Wide310x150Logo.png", 310, 150, 0.66);
await logo("SmallTile.png", 71, 71, 0.8);
await logo("LargeTile.png", 310, 310, 0.6);
console.log(`Logos de la Store en ${out}`);
