"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // En desarrollo no hay service worker: si quedó uno de producción en este
      // origen (localhost), se quita junto con sus cachés para no servir código viejo.
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        await Promise.all(registrations.map((registration) => registration.unregister()));
        if ("caches" in window) {
          for (const key of await caches.keys()) {
            if (key.startsWith("stocko-")) await caches.delete(key);
          }
        }
        // Solo se recarga si un service worker estaba controlando esta página.
        if (registrations.length > 0) window.location.reload();
      });
      return;
    }

    function register() {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Sin service worker la aplicación sigue funcionando en línea.
      });
    }

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
