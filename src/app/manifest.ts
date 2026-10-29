import type { MetadataRoute } from "next";

// Application installable (PWA) : utilisable plein écran sur tablette/téléphone,
// et la caisse reste accessible sans réseau (voir public/sw.js).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "fishcore — Gestion de poissonnerie",
    short_name: "fishcore",
    description: "Caisse, stocks et pilotage des poissonneries, en ligne et hors connexion.",
    start_url: "/caisse",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f8fafc",
    theme_color: "#1d4ed8",
    lang: "fr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
