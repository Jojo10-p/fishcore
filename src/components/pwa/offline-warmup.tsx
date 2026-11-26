"use client";

import { useEffect } from "react";
import { useSession } from "@/components/app/session-provider";
import { refreshStandby } from "@/lib/offline/standby";
import { syncCatalogFromServer } from "@/lib/offline/sync";

// ─────────────────────────────────────────────
// Préparer l'appareil pour le hors connexion
// ─────────────────────────────────────────────
// Une fois connecté, avec du réseau (au plus toutes les 6 heures) :
//  - le service worker garde les pages principales (tableau de bord, caisse…) ;
//  - le catalogue et le stock de la boutique sont copiés sur l'appareil ;
//  - le caissier reçoit sa réserve pour ouvrir sa caisse sans Internet.
// Ainsi l'application s'ouvre et vend même si le réseau tombe avant la
// prochaine visite de ces pages.

const EVERY_MS = 6 * 3600_000;

export function OfflineWarmup() {
  const { session, fromCache, centerId, can } = useSession();
  const userId = session?.user.id;
  const sells = can("sale:create");
  const opens = can("cash:open_session");

  useEffect(() => {
    if (!userId || fromCache || typeof navigator === "undefined" || !navigator.onLine) return;
    const version = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
    const key = `gjh-warm:${userId}:${version}:${centerId ?? ""}`;
    let last = 0;
    try {
      last = Number(localStorage.getItem(key) || 0);
    } catch {
      /* ignore */
    }
    if (Date.now() - last < EVERY_MS) return;
    const t = setTimeout(async () => {
      try {
        localStorage.setItem(key, String(Date.now()));
      } catch {
        /* ignore */
      }
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        reg?.active?.postMessage({ type: "warm" });
      }
      if (sells && centerId) await syncCatalogFromServer(centerId).catch(() => false);
      if (sells && opens) await refreshStandby(userId).catch(() => null);
    }, 1500); // après l'affichage de la page
    return () => clearTimeout(t);
  }, [userId, fromCache, centerId, sells, opens]);

  return null;
}
