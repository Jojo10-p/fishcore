"use client";

import { useEffect, useRef, useState } from "react";
import { getOfflineDB } from "@/lib/offline/db";
import { syncCatalogFromServer, syncPendingOperations, installConnectivityListener, getPendingSyncCount } from "@/lib/offline/sync";

interface UseOfflineSyncOptions {
  centerId: string;
  onSyncComplete?: (result: { success: number; failed: number; total: number }) => void;
}

interface UseOfflineSyncReturn {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncAt: Date | null;
  syncNow: () => Promise<void>;
}

/**
 * Hook qui gère la connectivité et la synchronisation offline/online.
 */
export function useOfflineSync({
  centerId,
  onSyncComplete,
}: UseOfflineSyncOptions): UseOfflineSyncReturn {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const hasSyncedCatalog = useRef(false);

  // Mettre à jour le compteur de pending
  const refreshPendingCount = async () => {
    const count = await getPendingSyncCount();
    setPendingCount(count);
  };

  // Sync catalogue au premier montage
  useEffect(() => {
    if (isOnline && !hasSyncedCatalog.current && centerId) {
      hasSyncedCatalog.current = true;
      syncCatalogFromServer(centerId).then(() => {
        setLastSyncAt(new Date());
      });
    }
    refreshPendingCount();
  }, [centerId, isOnline]);

  // Écouteur connectivité
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Sync auto quand reconnexion
    const cleanup = installConnectivityListener(async (result) => {
      setLastSyncAt(new Date());
      await refreshPendingCount();
      onSyncComplete?.(result);
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      cleanup();
    };
  }, [onSyncComplete]);

  // Sync manuelle
  const syncNow = async () => {
    if (isSyncing || !isOnline) return;
    setIsSyncing(true);
    try {
      const result = await syncPendingOperations();
      await syncCatalogFromServer(centerId);
      setLastSyncAt(new Date());
      await refreshPendingCount();
      onSyncComplete?.(result);
    } finally {
      setIsSyncing(false);
    }
  };

  return { isOnline, isSyncing, pendingCount, lastSyncAt, syncNow };
}

/**
 * Hook pour accéder au stock offline d'un centre.
 */
export function useOfflineStock(centerId: string) {
  const [stocks, setStocks] = useState<Array<{
    productId: string;
    quantity: number;
    reservedQty: number;
  }>>([]);

  useEffect(() => {
    if (!centerId) return;
    const db = getOfflineDB();
    db.stocks.where("centerId").equals(centerId).toArray().then((s) => {
      setStocks(s.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        reservedQty: item.reservedQty,
      })));
    });
  }, [centerId]);

  return stocks;
}
