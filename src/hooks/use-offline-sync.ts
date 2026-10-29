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

const AUTO_SYNC_INTERVAL_MS = 30_000;

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
 * Connectivité + synchronisation automatique (au retour du réseau et toutes
 * les 30 s : l'événement « online » du navigateur n'est pas toujours fiable).
 */
export function useOfflineSync({ centerId, sessionId, onSyncComplete }: UseOfflineSyncOptions): UseOfflineSyncReturn {
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const onSyncRef = useRef(onSyncComplete);
  useEffect(() => {
    onSyncRef.current = onSyncComplete;
  }, [onSyncComplete]);

  const refreshCounts = useCallback(async () => {
    const [p, c] = await Promise.all([getPendingSyncCount(), getConflictCount()]);
    setPendingCount(p);
    setConflictCount(c);
  }, []);

  const syncNow = useCallback(async () => {
    if (!centerId || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    setIsSyncing(true);
    try {
      const result = await syncPendingOperations();
      setNeedsLogin(result.needsLogin);
      // Le catalogue est rafraîchi APRÈS l'envoi : le stock serveur inclut alors nos ventes
      if (await syncCatalogFromServer(centerId, sessionId)) setLastSyncAt(new Date());
      onSyncRef.current?.(result);
    } finally {
      await refreshCounts();
      setIsSyncing(false);
    }
  }, [centerId, sessionId, refreshCounts]);

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

  // Compteurs à jour après chaque vente locale
  useEffect(() => {
    const db = getOfflineDB();
    const onChange = () => void refreshCounts();
    db.syncQueue.hook("creating", onChange);
    db.syncQueue.hook("updating", onChange);
    const first = setTimeout(onChange, 0);
    return () => {
      clearTimeout(first);
      db.syncQueue.hook("creating").unsubscribe(onChange);
      db.syncQueue.hook("updating").unsubscribe(onChange);
    };
  }, [refreshCounts]);

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
