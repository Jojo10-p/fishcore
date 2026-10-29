import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";

// Application installable (PWA) : utilisable plein écran sur tablette/téléphone,
// et la caisse reste accessible sans réseau (voir public/sw.js).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — Gestion commerciale`,
    short_name: APP_NAME,
    description: `${APP_TAGLINE}, en ligne et hors connexion.`,
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
