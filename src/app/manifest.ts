import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Stocko",
    short_name: "Stocko",
    description: "Inventario, ventas y clientes para negocios pequeños.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f3",
    theme_color: "#0f766e",
    lang: "es",
    dir: "ltr",
    orientation: "portrait-primary",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Nueva venta",
        short_name: "Vender",
        url: "/ventas/nueva",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Inventario",
        url: "/inventario",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Clientes",
        url: "/clientes",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
