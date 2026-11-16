import { mkdir } from "node:fs/promises";
import sharp from "sharp";

/**
 * Genera los íconos PNG de la PWA a partir del mismo dibujo de src/app/icon.svg.
 * Uso: npx tsx scripts/generate-icons.ts
 */
const mark = (size: number, inset: number, rounded: boolean) => {
  const scale = (size - inset * 2) / 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rounded ? 112 * (size / 512) : 0}" fill="#0f766e"/>
  <g transform="translate(${inset} ${inset}) scale(${scale})">
    <rect x="152" y="104" width="208" height="132" rx="46" fill="#ffffff"/>
    <rect x="96" y="268" width="320" height="148" rx="50" fill="#ffffff" fill-opacity="0.55"/>
  </g>
</svg>`;
};

await mkdir("public/icons", { recursive: true });
const jobs: Array<[string, number, number, boolean]> = [
  ["public/icons/icon-192.png", 192, 0, true],
  ["public/icons/icon-512.png", 512, 0, true],
  // Maskable: fondo completo y dibujo dentro de la zona segura (80 %).
  ["public/icons/maskable-512.png", 512, 51, false],
  ["src/app/apple-icon.png", 180, 18, false],
];
for (const [file, size, inset, rounded] of jobs) {
  await sharp(Buffer.from(mark(size, inset, rounded))).png().toFile(file);
  console.log("Creado", file);
}
