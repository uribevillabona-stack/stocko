import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageError, processProductPhoto } from "@/lib/images";
import { isValidPhotoKey, newPhotoKey, photoUrl } from "@/lib/storage";

describe("fotos de producto", () => {
  it("reduce, gira y convierte a WebP", async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#0f766e" } })
      .jpeg()
      .toBuffer();
    const out = await processProductPhoto(big);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(800);
    expect(meta.exif).toBeUndefined();
  });

  it("rechaza archivos que no son imágenes aunque digan serlo", async () => {
    await expect(processProductPhoto(Buffer.from("<svg onload=alert(1)>"))).rejects.toBeInstanceOf(ImageError);
    await expect(processProductPhoto(Buffer.alloc(0))).rejects.toBeInstanceOf(ImageError);
    await expect(processProductPhoto(Buffer.alloc(6 * 1024 * 1024))).rejects.toBeInstanceOf(ImageError);
  });

  it("claves aleatorias y sin rutas peligrosas", () => {
    const business = "4d6f7a3e-8b1c-4c2a-9f3e-2b1a0c9d8e7f";
    const key = newPhotoKey(business);
    expect(isValidPhotoKey(key)).toBe(true);
    expect(key.startsWith(`${business}/`)).toBe(true);
    expect(newPhotoKey(business)).not.toBe(key);
    expect(isValidPhotoKey("../../etc/passwd")).toBe(false);
    expect(isValidPhotoKey(`${business}/../x.webp`)).toBe(false);
    expect(photoUrl(key)).toBe(`/api/fotos/${key}`);
    expect(photoUrl(null)).toBeNull();
  });
});
