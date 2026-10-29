"use client";

import { useEffect } from "react";

/** Enregistre le service worker (production uniquement : en dev il gênerait le rechargement à chaud). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error) => {
      console.warn("[PWA] Enregistrement du service worker impossible :", error);
    });
  }, []);
  return null;
}
