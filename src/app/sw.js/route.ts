import { PRODUCTION_SW, RESET_SW } from "@/lib/pwa/service-worker-source";

/**
 * /sw.js: en producción, el service worker de la PWA (caché de archivos estáticos
 * y fotos). En desarrollo, uno que borra las cachés y se desregistra: los
 * archivos de /_next/static cambian sin cambiar de nombre, y un service worker
 * de producción que haya quedado en localhost serviría JavaScript viejo.
 * El navegador revisa /sw.js en cada visita, así que se corrige solo.
 */
export const dynamic = "force-static";

export function GET() {
  const source = process.env.NODE_ENV === "production" ? PRODUCTION_SW : RESET_SW;
  return new Response(source, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
