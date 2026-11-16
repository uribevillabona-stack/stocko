import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["jpeg", "png", "webp", "heif", "avif"]);

export class ImageError extends Error {}

/**
 * Valida por contenido (no por extensión) y normaliza: gira según EXIF, quita
 * metadatos (ubicación incluida), reduce a 1200 px y convierte a WebP.
 */
export async function processProductPhoto(input: Buffer): Promise<Buffer> {
  if (input.length === 0) throw new ImageError("El archivo está vacío.");
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("La foto pesa más de 5 MB.");

  let format: string | undefined;
  try {
    const meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    format = meta.format;
  } catch {
    throw new ImageError("El archivo no es una imagen válida.");
  }
  if (!format || !ALLOWED.has(format)) {
    throw new ImageError("Usa una foto JPG, PNG o WebP.");
  }

  return sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}
