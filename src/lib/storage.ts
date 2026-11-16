import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { env } from "@/lib/env";

/**
 * Almacenamiento de fotos de producto.
 * - S3 (Neon Object Storage) si están las variables NEON_STORAGE_*.
 * - Carpeta local si LOCAL_UPLOADS_DIR está definida (desarrollo o servidor
 *   propio con disco; no sirve en Netlify, cuyo disco es efímero).
 * - Si no hay ninguno, las fotos están desactivadas y el campo no aparece.
 * Las claves son `<negocio>/<uuid>.webp`: imposibles de adivinar.
 */

type Driver = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  remove(key: string): Promise<void>;
};

const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/;

export function isValidPhotoKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function newPhotoKey(businessId: string): string {
  return `${businessId}/${randomUUID()}.webp`;
}

function s3Configured() {
  return Boolean(
    env.NEON_STORAGE_ENDPOINT &&
      env.NEON_STORAGE_BUCKET &&
      env.NEON_STORAGE_ACCESS_KEY_ID &&
      env.NEON_STORAGE_SECRET_ACCESS_KEY,
  );
}

function localDir(): string | null {
  if (!env.LOCAL_UPLOADS_DIR) return null;
  return resolve(env.LOCAL_UPLOADS_DIR);
}

export function photosEnabled(): boolean {
  return s3Configured() || localDir() !== null;
}

let cached: Driver | null | undefined;

async function driver(): Promise<Driver | null> {
  if (cached !== undefined) return cached;

  if (s3Configured()) {
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import(
      "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      endpoint: env.NEON_STORAGE_ENDPOINT,
      region: env.NEON_STORAGE_REGION || "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.NEON_STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: env.NEON_STORAGE_SECRET_ACCESS_KEY!,
      },
    });
    const Bucket = env.NEON_STORAGE_BUCKET!;
    cached = {
      async put(key, body, contentType) {
        await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
      },
      async get(key) {
        try {
          const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
          if (!result.Body) return null;
          const bytes = await result.Body.transformToByteArray();
          return { body: Buffer.from(bytes), contentType: result.ContentType ?? "image/webp" };
        } catch (error) {
          if ((error as { name?: string }).name === "NoSuchKey") return null;
          throw error;
        }
      },
      async remove(key) {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      },
    };
    return cached;
  }

  const base = localDir();
  if (base) {
    const pathFor = (key: string) => {
      const full = resolve(/*turbopackIgnore: true*/ base, /*turbopackIgnore: true*/ key);
      if (!full.startsWith(base + sep)) throw new Error("Clave de foto inválida");
      return full;
    };
    cached = {
      async put(key, body) {
        const file = pathFor(key);
        await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
        await writeFile(/*turbopackIgnore: true*/ file, body);
      },
      async get(key) {
        try {
          // Ruta dinámica a propósito (carpeta configurable): no rastrear el proyecto.
          return { body: await readFile(/*turbopackIgnore: true*/ pathFor(key)), contentType: "image/webp" };
        } catch {
          return null;
        }
      },
      async remove(key) {
        await rm(/*turbopackIgnore: true*/ pathFor(key), { force: true });
      },
    };
    return cached;
  }

  cached = null;
  return cached;
}

export async function putPhoto(key: string, body: Buffer) {
  const store = await driver();
  if (!store) throw new Error("El almacenamiento de fotos no está configurado");
  await store.put(key, body, "image/webp");
}

export async function getPhoto(key: string) {
  if (!isValidPhotoKey(key)) return null;
  const store = await driver();
  return store ? store.get(key) : null;
}

export async function removePhoto(key: string) {
  if (!isValidPhotoKey(key)) return;
  const store = await driver();
  await store?.remove(key);
}

export function photoUrl(key: string | null | undefined): string | null {
  return key ? `/api/fotos/${key}` : null;
}
