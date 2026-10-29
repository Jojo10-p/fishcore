"use client";

import { getOfflineDB, type SyncOperation } from "./db";
import { generateIdempotencyKey } from "@/lib/utils";

// ─────────────────────────────────────────────
// Gestionnaire de synchronisation offline → online
// ─────────────────────────────────────────────

const MAX_RETRIES = 5;

/** Refus définitif du serveur (règle métier) : inutile de réessayer. */
export class SyncConflictError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** Session expirée : on garde l'opération en attente sans consommer d'essai. */
class SyncAuthError extends Error {}

/**
 * Ajoute une vente offline à la file d'attente de sync.
 */
export async function queueSaleForSync(saleId: string, payload: Record<string, unknown>): Promise<void> {
  const db = getOfflineDB();
  const op: SyncOperation = {
    id: generateIdempotencyKey(),
    type: "sale",
    referenceId: saleId,
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    attemptCount: 0,
  };
  await db.syncQueue.add(op);
}

/**
 * Lance la synchronisation des opérations en attente.
 * À appeler quand la connexion est rétablie.
 */
export async function syncPendingOperations(): Promise<{
  success: number;
  failed: number;
  total: number;
}> {
  const db = getOfflineDB();
  const pendingOps = await db.syncQueue
    .where("status")
    .anyOf(["pending", "failed"])
    .and((op) => op.attemptCount < MAX_RETRIES)
    .toArray();

  let successCount = 0;
  let failedCount = 0;

  for (const op of pendingOps) {
    // Marquer comme en cours
    await db.syncQueue.update(op.id, {
      status: "syncing",
      lastAttemptAt: new Date().toISOString(),
    });

    try {
      await syncOperation(op);

      // Succès
      await db.syncQueue.update(op.id, { status: "synced" });

      // Si c'est une vente, marquer la vente comme synchronisée
      if (op.type === "sale") {
        await db.sales.update(op.referenceId, {
          syncStatus: "synced",
          syncedAt: new Date().toISOString(),
        });
      }

      successCount++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erreur inconnue";

      if (error instanceof SyncAuthError) {
        await db.syncQueue.update(op.id, { status: "pending", error: errorMessage });
        failedCount++;
        break; // inutile d'envoyer les suivantes tant que l'utilisateur n'est pas reconnecté
      }

      if (error instanceof SyncConflictError) {
        await db.syncQueue.update(op.id, { status: "conflict", error: errorMessage });
        if (op.type === "sale") {
          await db.sales.update(op.referenceId, { syncStatus: "conflict", syncError: errorMessage });
        }
        failedCount++;
        continue;
      }

      await db.syncQueue.update(op.id, {
        status: "failed",
        error: errorMessage,
        attemptCount: op.attemptCount + 1,
      });

      if (op.type === "sale") {
        await db.sales.update(op.referenceId, {
          syncStatus: "failed",
          syncError: errorMessage,
          retryCount: op.attemptCount + 1,
        });
      }

      failedCount++;
    }
  }

  return { success: successCount, failed: failedCount, total: pendingOps.length };
}

/**
 * Exécute une opération de sync vers le serveur.
 */
async function syncOperation(op: SyncOperation): Promise<void> {
  let endpoint: string;

  switch (op.type) {
    case "sale":
      endpoint = "/api/sales";
      break;
    case "cash_session":
      endpoint = "/api/cash/sessions";
      break;
    default:
      throw new Error(`Type d'opération inconnu : ${op.type}`);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(op.payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data.error ?? `Erreur serveur ${response.status}`;
    if (response.status === 401) throw new SyncAuthError(message);
    // 4xx (hors délai / limitation) = refus métier définitif → conflit à traiter
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      throw new SyncConflictError(message, data.code);
    }
    throw new Error(message);
  }
}

/**
 * Synchronise le catalogue produits et les stocks depuis le serveur.
 * À appeler au démarrage ou après reconnexion.
 */
export async function syncCatalogFromServer(centerId: string): Promise<void> {
  const db = getOfflineDB();

  try {
    // Sync produits
    const productsRes = await fetch(`/api/products?centerId=${centerId}`);
    if (productsRes.ok) {
      const { data: products } = await productsRes.json();
      if (Array.isArray(products)) {
        await db.transaction("rw", db.products, async () => {
          await db.products.clear();
          await db.products.bulkAdd(products);
        });
      }
    }

    // Sync stocks
    const stockRes = await fetch(`/api/stock?centerId=${centerId}`);
    if (stockRes.ok) {
      const { data: stocks } = await stockRes.json();
      if (Array.isArray(stocks)) {
        await db.transaction("rw", db.stocks, async () => {
          await db.stocks.where("centerId").equals(centerId).delete();
          await db.stocks.bulkAdd(stocks.map((s: {
            centerId: string;
            productId: string;
            quantity: number;
            reservedQty: number;
            version: number;
          }) => ({
            ...s,
            id: `${s.centerId}_${s.productId}`,
            lastSyncedAt: new Date().toISOString(),
          })));
        });
      }
    }
  } catch (error) {
    console.warn("[SYNC] Échec sync catalogue:", error);
    // Ne pas bloquer le fonctionnement offline
  }
}

/**
 * Retourne le nombre d'opérations refusées par le serveur, à traiter par un responsable.
 */
export async function getConflictCount(): Promise<number> {
  const db = getOfflineDB();
  return db.syncQueue.where("status").equals("conflict").count();
}

/**
 * Retourne le nombre d'opérations en attente de sync.
 */
export async function getPendingSyncCount(): Promise<number> {
  const db = getOfflineDB();
  return db.syncQueue
    .where("status")
    .anyOf(["pending", "failed"])
    .count();
}

/**
 * Installe un écouteur de connectivité pour auto-syncer.
 */
export function installConnectivityListener(
  onSync?: (result: { success: number; failed: number; total: number }) => void
): () => void {
  const handleOnline = async () => {
    console.log("[SYNC] Connexion rétablie — lancement de la synchronisation...");
    const result = await syncPendingOperations();
    onSync?.(result);
  };

  window.addEventListener("online", handleOnline);
  return () => window.removeEventListener("online", handleOnline);
}
