import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
// HSTS y upgrade-insecure-requests solo cuando la app se sirve con https
// (en http://localhost romperían la carga de recursos).
const isHttps = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");

/**
 * Política de contenido. Next necesita scripts y estilos en línea para hidratar;
 * en desarrollo además usa eval. Las fotos se sirven desde el mismo origen
 * (/api/fotos) y las vistas previas usan blob:.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

// Versión de escritorio (desktop/): servidor autónomo en una carpeta aparte para no
// pisar el build normal (`npm start`, Netlify).
const isDesktop = process.env.STOCKO_DESKTOP === "1";

const nextConfig: NextConfig = {
  ...(isDesktop ? { output: "standalone" as const, distDir: ".next-desktop" } : {}),
  serverExternalPackages: ["pg", "sharp"],
  poweredByHeader: false,
  experimental: {
    // Fotos de producto: hasta 5 MB por archivo (se reducen en el servidor).
    serverActions: { bodySizeLimit: "6mb" },
    // Escritorio: la caché de rutas queda en memoria. En disco iría a la carpeta
    // del programa (que debe poder reemplazarse al actualizar y borrarse al
    // desinstalar) con rutas de más de 260 caracteres que Windows no borra.
    ...(isDesktop ? { isrFlushToDisk: false } : {}),
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // El service worker no debe quedar en caché para que las actualizaciones lleguen.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
