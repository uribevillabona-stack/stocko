// Código de los service workers, servido por src/app/sw.js/route.ts.
// Producción: caché de la PWA. Desarrollo: uno que se borra a sí mismo (RESET_SW).

export const PRODUCTION_SW = `const CACHE = "stocko-static-v4";
const PHOTO_CACHE = "stocko-photos-v1";
const PHOTO_LIMIT = 200;
const OFFLINE_URL = "/offline";
const PRECACHE = [
  OFFLINE_URL,
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];
// Se piden primero a la red para que los cambios lleguen; la caché es respaldo.
const NETWORK_FIRST = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE && key !== PHOTO_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Mantiene la caché de fotos por debajo del tope (borra las más antiguas). */
async function trimPhotos() {
  const cache = await caches.open(PHOTO_CACHE);
  const keys = await cache.keys();
  const excess = keys.length - PHOTO_LIMIT;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Las fotos son inmutables (clave única): caché primero, con tope de entradas.
  if (url.pathname.startsWith("/api/fotos/")) {
    event.respondWith(
      caches.open(PHOTO_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) {
                event.waitUntil(cache.put(request, response.clone()).then(trimPhotos));
              }
              return response;
            }),
        ),
      ),
    );
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (NETWORK_FIRST.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
          }
          return response;
        });
      }),
    );
  }
});
`;

export const RESET_SW = `// Service worker de limpieza (solo en desarrollo: src/app/sw.js/route.ts lo sirve como /sw.js).
//
// Si en localhost quedó registrado el service worker de producción, seguiría
// sirviendo desde su caché el JavaScript viejo de /_next/static/ y la página
// fallaría al hidratar. El navegador revisa /sw.js en cada visita: al encontrar
// este, lo instala; borra las cachés, se desregistra y recarga las pestañas.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
`;
