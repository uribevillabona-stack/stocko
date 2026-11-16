import { getPhoto, isValidPhotoKey } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Sirve fotos de producto. Las claves llevan un UUID aleatorio y nunca cambian
 * de contenido, así que se cachean como inmutables. Son públicas porque el
 * catálogo en línea también las muestra.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.join("/");
  if (!isValidPhotoKey(key)) return new Response("Not found", { status: 404 });

  const photo = await getPhoto(key);
  if (!photo) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(photo.body), {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
