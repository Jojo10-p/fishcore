"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getOfflineDB } from "@/lib/offline/db";
import {
  getConflictCount,
  getPendingSyncCount,
  installConnectivityListener,
  syncCatalogFromServer,
  syncPendingOperations,
  type SyncResult,
} from "@/lib/offline/sync";

/** Synchronisation complète de secours. */
const AUTO_SYNC_INTERVAL_MS = 60_000;
/** Vérification légère des changements (stock, catalogue) : fenêtre visible / en arrière-plan. */
const WATCH_INTERVAL_MS = 5_000;
const WATCH_HIDDEN_INTERVAL_MS = 30_000;

interface UseOfflineSyncOptions {
  centerId: string;
  /** Session de caisse ouverte : ses réserves hors ligne sont rafraîchies aussi. */
  sessionId?: string;
  onSyncComplete?: (result: SyncResult) => void;
}

export interface UseOfflineSyncReturn {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  conflictCount: number;
  needsLogin: boolean;
  lastSyncAt: Date | null;
  syncNow: () => Promise<void>;
}

/**
 * La caisse reste à jour toute seule, en ligne comme hors ligne :
 *  - une vente enregistrée sur l'appareil part au serveur aussitôt que possible ;
 *  - toutes les 5 s, une empreinte légère du stock et du catalogue est comparée :
 *    réception validée, vente d'une autre caisse, prix modifié… → rechargement ;
 *  - au retour du réseau (et toutes les 60 s par sécurité), synchronisation complète.
 */
type Stamp = { stock: string; catalog: string };

/** Empreintes du stock et du catalogue du centre ; « auth » si la session a expiré. */
async function fetchStamp(centerId: string): Promise<Stamp | "auth" | null> {
  try {
    const res = await fetch(`/api/sync/state?centerId=${encodeURIComponent(centerId)}`, { cache: "no-store" });
    if (res.status === 401) return "auth";
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data: Stamp };
    return { stock: data.stock, catalog: data.catalog };
  } catch {
    return null;
  }
}

export function useOfflineSync({ centerId, sessionId, onSyncComplete }: UseOfflineSyncOptions): UseOfflineSyncReturn {
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const onSyncRef = useRef(onSyncComplete);
  const stampRef = useRef<Stamp | null>(null);
  const watchingRef = useRef(false);
  useEffect(() => {
    onSyncRef.current = onSyncComplete;
  }, [onSyncComplete]);

  const refreshCounts = useCallback(async () => {
    const [p, c] = await Promise.all([getPendingSyncCount(), getConflictCount()]);
    setPendingCount(p);
    setConflictCount(c);
  }, []);

  const syncNow = useCallback(async (options: { stockOnly?: boolean } = {}) => {
    if (!centerId || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    setIsSyncing(true);
    try {
      const result = await syncPendingOperations();
      setNeedsLogin(result.needsLogin);
      // Empreinte relevée AVANT le rechargement : un changement survenu pendant
      // le rechargement sera vu au prochain contrôle (rien ne peut être manqué)
      const stamp = await fetchStamp(centerId);
      // Le catalogue est rafraîchi APRÈS l'envoi : le stock serveur inclut alors nos ventes
      if (await syncCatalogFromServer(centerId, sessionId, options)) {
        setLastSyncAt(new Date());
        if (stamp && stamp !== "auth") {
          // Stock seul rechargé : la référence du catalogue ne bouge pas
          stampRef.current = options.stockOnly && stampRef.current ? { ...stamp, catalog: stampRef.current.catalog } : stamp;
        }
      }
      onSyncRef.current?.(result);
    } finally {
      await refreshCounts();
      setIsSyncing(false);
    }
  }, [centerId, sessionId, refreshCounts]);

  // Surveillance légère : envoie ce qui attend, recharge ce qui a changé côté serveur
  const watch = useCallback(async () => {
    if (!centerId || watchingRef.current || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    watchingRef.current = true;
    try {
      if ((await getPendingSyncCount()) > 0) {
        await syncNow();
        return;
      }
      const stamp = await fetchStamp(centerId);
      if (stamp === "auth") {
        setNeedsLogin(true);
        return;
      }
      if (!stamp) return;
      setIsOnline(true);
      const ref = stampRef.current;
      // Pas encore de référence ou catalogue modifié : tout ; stock seul modifié : le stock
      if (!ref || stamp.catalog !== ref.catalog) await syncNow();
      else if (stamp.stock !== ref.stock) await syncNow({ stockOnly: true });
    } catch {
      // Serveur injoignable : la caisse continue sur l'appareil
    } finally {
      watchingRef.current = false;
    }
  }, [centerId, syncNow]);

  useEffect(() => {
    if (!centerId) return;
    stampRef.current = null;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(async () => {
        await watch();
        loop();
      }, document.visibilityState === "visible" ? WATCH_INTERVAL_MS : WATCH_HIDDEN_INTERVAL_MS);
    };
    loop();
    const onVisible = () => document.visibilityState === "visible" && void watch();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [centerId, watch]);

  // Synchro initiale + périodique
  useEffect(() => {
    if (!centerId) return;
    const first = setTimeout(() => void syncNow(), 0);
    const timer = setInterval(() => void syncNow(), AUTO_SYNC_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [centerId, syncNow]);

  // Connectivité
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const cleanup = installConnectivityListener(() => void syncNow());
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      cleanup();
    };
  }, [syncNow]);

  // Compteurs à jour après chaque vente locale ; une vente mise en file part aussitôt
  useEffect(() => {
    const db = getOfflineDB();
    // setTimeout : hors de la transaction locale qui a déclenché le crochet
    const onChange = () => setTimeout(() => void refreshCounts(), 0);
    const onQueued = () =>
      setTimeout(() => {
        void refreshCounts();
        void watch();
      }, 200);
    db.syncQueue.hook("creating", onQueued);
    db.syncQueue.hook("updating", onChange);
    const first = setTimeout(() => void refreshCounts(), 0);
    return () => {
      clearTimeout(first);
      db.syncQueue.hook("creating").unsubscribe(onQueued);
      db.syncQueue.hook("updating").unsubscribe(onChange);
    };
  }, [refreshCounts, watch]);

  return { isOnline, isSyncing, pendingCount, conflictCount, needsLogin, lastSyncAt, syncNow };
}

/** Stock local d'un centre (affichage). */
export function useOfflineStock(centerId: string) {
  const [stocks, setStocks] = useState<Array<{ productId: string; quantity: number; reservedQty: number }>>([]);

  useEffect(() => {
    if (!centerId) return;
    const db = getOfflineDB();
    db.stocks
      .where("centerId")
      .equals(centerId)
      .toArray()
      .then((s) => setStocks(s.map(({ productId, quantity, reservedQty }) => ({ productId, quantity, reservedQty }))));
  }, [centerId]);

  return stocks;
}
