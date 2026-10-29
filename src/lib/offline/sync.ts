"use client";

import Dexie from "dexie";
import { getOfflineDB, getUnconfirmedQuantities, type OfflineProduct, type SyncOperation } from "./db";
import { generateIdempotencyKey } from "@/lib/utils";

// ─────────────────────────────────────────────
// Synchronisation hors ligne → serveur (cahier §11.3, §11.4)
// ─────────────────────────────────────────────
// - Ordre chronologique préservé (les opérations dépendantes passent dans l'ordre).
// - Une seule synchronisation à la fois (verrou en mémoire).
// - Reprise après coupure : une opération restée « syncing » est retentée
//   (sans risque : le serveur est idempotent).
// - Refus métier (stock, prix, session clôturée) → statut « conflict »,
//   conservé pour traitement humain, jamais retenté automatiquement.

const MAX_RETRIES = 5;
const STALE_SYNCING_MS = 60_000;

/** Refus définitif du serveur (règle métier) : inutile de réessayer. */
export class SyncConflictError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** Session expirée : on garde l'opération en attente sans consommer d'essai. */
class SyncAuthError extends Error {}

export type SyncResult = { success: number; failed: number; conflicts: number; total: number; needsLogin: boolean };

/**
 * Ajoute une vente offline à la file d'attente de sync.
 * Peut être appelée dans une transaction Dexie qui inclut db.syncQueue.
 */
export async function queueSaleForSync(saleId: string, payload: Record<string, unknown>): Promise<void> {
  const db = getOfflineDB();
  const op: SyncOperation = {
    id: generateIdempotencyKey("op"),
    type: "sale",
    referenceId: saleId,
    payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    attemptCount: 0,
  };
  await db.syncQueue.add(op);
}

let running: Promise<SyncResult> | null = null;

/** Lance la synchronisation (un seul passage à la fois, les appels concurrents attendent le même). */
export function syncPendingOperations(): Promise<SyncResult> {
  // Hors de toute transaction locale : la synchro peut être déclenchée depuis le
  // code d'une vente (transaction déjà terminée) — Dexie la rattacherait sinon.
  running ??= Dexie.ignoreTransaction(() => runSync()).finally(() => {
    running = null;
  });
  return running;
}

async function runSync(): Promise<SyncResult> {
  const db = getOfflineDB();
  const now = Date.now();
  const ops = (await db.syncQueue.where("status").anyOf(["pending", "failed", "syncing"]).toArray())
    .filter((op) => {
      if (op.status === "syncing") {
        // Restée « en cours » après une coupure : on la reprend
        return !op.lastAttemptAt || now - Date.parse(op.lastAttemptAt) > STALE_SYNCING_MS;
      }
      return op.attemptCount < MAX_RETRIES;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const result: SyncResult = { success: 0, failed: 0, conflicts: 0, total: ops.length, needsLogin: false };

  for (const op of ops) {
    await db.syncQueue.update(op.id, { status: "syncing", lastAttemptAt: new Date().toISOString() });
    if (op.type === "sale") await db.sales.update(op.referenceId, { syncStatus: "syncing" });

    try {
      await sendOperation(op);
      await db.transaction("rw", db.syncQueue, db.sales, async () => {
        await db.syncQueue.update(op.id, { status: "synced", error: undefined });
        if (op.type === "sale") {
          await db.sales.update(op.referenceId, { syncStatus: "synced", syncedAt: new Date().toISOString(), syncError: undefined });
        }
      });
      result.success++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";

      if (error instanceof SyncAuthError) {
        await db.syncQueue.update(op.id, { status: "pending", error: message });
        if (op.type === "sale") await db.sales.update(op.referenceId, { syncStatus: "pending", syncError: message });
        result.needsLogin = true;
        break; // inutile d'envoyer les suivantes tant que l'utilisateur n'est pas reconnecté
      }

      if (error instanceof SyncConflictError) {
        await db.syncQueue.update(op.id, { status: "conflict", error: message });
        if (op.type === "sale") await db.sales.update(op.referenceId, { syncStatus: "conflict", syncError: message });
        result.conflicts++;
        continue;
      }

      // Erreur réseau / serveur : nouvel essai plus tard
      await db.syncQueue.update(op.id, { status: "failed", error: message, attemptCount: op.attemptCount + 1 });
      if (op.type === "sale") {
        await db.sales.update(op.referenceId, { syncStatus: "failed", syncError: message, retryCount: op.attemptCount + 1 });
      }
      result.failed++;
      // Probablement hors ligne : on s'arrête pour garder l'ordre des opérations
      break;
    }
  }

  return result;
}

async function sendOperation(op: SyncOperation): Promise<void> {
  const endpoint = op.type === "sale" ? "/api/sales" : op.type === "cash_session" ? "/api/cash/sessions" : null;
  if (!endpoint) throw new SyncConflictError(`Type d'opération inconnu : ${op.type}`);

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

/** Remet une opération (échouée ou en conflit) dans la file, à la demande d'un utilisateur. */
export async function retryOperation(opId: string): Promise<void> {
  const db = getOfflineDB();
  const op = await db.syncQueue.get(opId);
  if (!op) return;
  await db.syncQueue.update(opId, { status: "pending", attemptCount: 0, error: undefined });
  if (op.type === "sale") await db.sales.update(op.referenceId, { syncStatus: "pending", syncError: undefined });
}

/**
 * Rafraîchit le catalogue, le stock et les réserves de la session depuis le serveur.
 * Le stock local = stock serveur − ventes locales non encore confirmées :
 * une vente hors ligne en attente n'est jamais « effacée » par le rafraîchissement.
 */
export async function syncCatalogFromServer(centerId: string, sessionId?: string): Promise<boolean> {
  const db = getOfflineDB();
  try {
    const [productsRes, stockRes, reservationsRes] = await Promise.all([
      fetch(`/api/products?centerId=${encodeURIComponent(centerId)}`),
      fetch(`/api/stock?centerId=${encodeURIComponent(centerId)}`),
      sessionId ? fetch(`/api/stock/reservations?sessionId=${encodeURIComponent(sessionId)}`) : Promise.resolve(null),
    ]);
    if (!productsRes.ok || !stockRes.ok) return false;

    // offlineData : nombres (et non chaînes Decimal) au format attendu par IndexedDB
    const { offlineData: products } = (await productsRes.json()) as { offlineData: OfflineProduct[] };
    const { offlineData: stocks } = (await stockRes.json()) as {
      offlineData: Array<{ id: string; centerId: string; productId: string; quantity: number; reservedQty: number; version: number }>;
    };
    const reservations = reservationsRes?.ok
      ? ((await reservationsRes.json()) as { data: Array<{ productId: string; quantity: number }> }).data
      : null;

    const unconfirmed = await getUnconfirmedQuantities();
    const syncedAt = new Date().toISOString();

    await db.transaction("rw", [db.products, db.stocks, db.reservations], async () => {
      if (Array.isArray(products)) {
        await db.products.clear();
        await db.products.bulkPut(products);
      }
      if (Array.isArray(stocks)) {
        await db.stocks.where("centerId").equals(centerId).delete();
        await db.stocks.bulkPut(
          stocks.map((s) => ({
            ...s,
            quantity: Math.max(0, s.quantity - (unconfirmed.get(s.productId) ?? 0)),
            lastSyncedAt: syncedAt,
          }))
        );
      }
      if (sessionId && reservations) {
        await db.reservations.where("sessionId").equals(sessionId).delete();
        await db.reservations.bulkPut(
          reservations.map((r) => ({
            id: `${sessionId}_${r.productId}`,
            sessionId,
            productId: r.productId,
            serverQuantity: r.quantity,
            lastSyncedAt: syncedAt,
          }))
        );
      }
    });
    return true;
  } catch (error) {
    console.warn("[SYNC] Échec sync catalogue:", error);
    return false; // ne pas bloquer le fonctionnement hors ligne
  }
}

/** Nombre d'opérations refusées par le serveur, à traiter par un responsable. */
export async function getConflictCount(): Promise<number> {
  const db = getOfflineDB();
  return Dexie.ignoreTransaction(() => db.syncQueue.where("status").equals("conflict").count());
}

/** Nombre d'opérations en attente d'envoi. */
export async function getPendingSyncCount(): Promise<number> {
  const db = getOfflineDB();
  return Dexie.ignoreTransaction(() => db.syncQueue.where("status").anyOf(["pending", "failed", "syncing"]).count());
}

/** Lance une synchronisation à chaque retour de la connexion. */
export function installConnectivityListener(onSync?: (result: SyncResult) => void): () => void {
  const handleOnline = async () => {
    const result = await syncPendingOperations();
    onSync?.(result);
  };
  window.addEventListener("online", handleOnline);
  return () => window.removeEventListener("online", handleOnline);
}
