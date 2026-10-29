"use client";

import { useEffect } from "react";

/** Enregistre le service worker (production uniquement : en dev il gênerait le rechargement à chaud). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // ?v= : un nouveau déploiement installe un nouveau service worker (et un cache neuf)
    const version = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/", updateViaCache: "none" }).catch((error) => {
      console.warn("[PWA] Enregistrement du service worker impossible :", error);
    });
  }, []);
  return null;
}
