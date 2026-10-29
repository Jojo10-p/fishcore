"use client";

import { getOfflineDB, getUnconfirmedQuantities, type OfflineSale, type OfflineSaleLine, type OfflinePayment } from "./db";
import { queueSaleForSync } from "./sync";
import { commitNumber } from "./numbering";
import { generateIdempotencyKey } from "@/lib/utils";

interface CreateOfflineSaleParams {
  sessionId: string;
  cashierId: string;
  centerId: string;
  companyId: string;
  customerId?: string;
  lines: OfflineSaleLine[];
  payments: OfflinePayment[];
  notes?: string;
  /** Clé déjà utilisée pour une tentative en ligne (repli hors ligne sans doublon). */
  idempotencyKey?: string;
  /** Numéro de facture pris dans la plage de la caisse (imprimé sur le ticket). */
  invoice?: { seq: number; saleNumber: string };
}

/**
 * Disponible hors ligne pour la session : réserve confirmée par le serveur
 * moins les ventes locales non encore synchronisées.
 */
export async function getOfflineAvailability(sessionId: string): Promise<Map<string, number>> {
  const db = getOfflineDB();
  const [reservations, unconfirmed] = await Promise.all([
    db.reservations.where("sessionId").equals(sessionId).toArray(),
    getUnconfirmedQuantities(sessionId),
  ]);
  const available = new Map<string, number>();
  for (const r of reservations) {
    available.set(r.productId, Math.max(0, r.serverQuantity - (unconfirmed.get(r.productId) ?? 0)));
  }
  return available;
}

/**
 * Crée une vente hors connexion (cahier §9.4).
 * La caisse ne peut vendre que dans la limite de SA réserve : sans réserve
 * suffisante, la vente est bloquée (pas de survente possible entre caisses).
 * La vente et son opération de synchronisation sont écrites dans la même
 * transaction locale (une coupure de courant ne peut pas les séparer).
 */
export async function createOfflineSale(params: CreateOfflineSaleParams): Promise<{
  success: boolean;
  saleId?: string;
  error?: string;
}> {
  const db = getOfflineDB();
  const idempotencyKey = params.idempotencyKey ?? generateIdempotencyKey("sale");

  const subtotal = params.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const discountAmount = params.lines.reduce((sum, l) => sum + l.discount * l.quantity, 0);
  const totalAmount = subtotal - discountAmount;

  // Quantités demandées par produit (un produit peut figurer sur plusieurs lignes)
  const requested = new Map<string, { qty: number; name: string }>();
  for (const line of params.lines) {
    const cur = requested.get(line.productId);
    requested.set(line.productId, { qty: (cur?.qty ?? 0) + line.baseQuantity, name: line.productName });
  }

  const soldAt = new Date().toISOString();
  try {
    await db.transaction("rw", [db.reservations, db.stocks, db.sales, db.syncQueue, db.numbering], async () => {
      // Contrôle dans la transaction : deux validations rapides ne peuvent pas
      // consommer deux fois la même réserve
      const available = await getOfflineAvailability(params.sessionId);
      for (const [productId, { qty, name }] of requested) {
        const left = available.get(productId) ?? 0;
        if (left < qty) {
          throw new Error(
            left <= 0
              ? `Aucune réserve hors ligne pour « ${name} ». Réservez du stock pour cette caisse quand la connexion est disponible.`
              : `Réserve hors ligne insuffisante pour « ${name} » : ${left} disponible(s), ${qty} demandé(s).`
          );
        }
      }

      // Affichage local du stock du centre (la vérité reste côté serveur)
      for (const [productId, { qty }] of requested) {
        const stockId = `${params.centerId}_${productId}`;
        const stock = await db.stocks.get(stockId);
        if (stock) await db.stocks.update(stockId, { quantity: Math.max(0, stock.quantity - qty) });
      }

      const sale: OfflineSale = {
        id: idempotencyKey,
        idempotencyKey,
        sessionId: params.sessionId,
        cashierId: params.cashierId,
        centerId: params.centerId,
        companyId: params.companyId,
        customerId: params.customerId,
        lines: params.lines,
        payments: params.payments,
        subtotal,
        discountAmount,
        totalAmount,
        notes: params.notes,
        invoiceSeq: params.invoice?.seq,
        saleNumber: params.invoice?.saleNumber,
        createdAt: soldAt,
        syncStatus: "pending",
        retryCount: 0,
      };
      await db.sales.add(sale);
      // Le numéro n'est consommé qu'avec la vente (même transaction locale)
      if (params.invoice) await commitNumber(params.sessionId, params.invoice.seq);

      await queueSaleForSync(idempotencyKey, {
        idempotencyKey,
        sessionId: params.sessionId,
        customerId: params.customerId,
        lines: params.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitId: l.unitId,
          unitPrice: l.unitPrice,
          discount: l.discount,
        })),
        payments: params.payments,
        notes: params.notes,
        ...(params.invoice ? { invoiceSeq: params.invoice.seq } : {}),
        soldAt,
        createdOffline: true,
        deviceId: getDeviceId(),
      });
    });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Erreur d'enregistrement local" };
  }

  return { success: true, saleId: idempotencyKey };
}

/** Vrai s'il reste des ventes de cette session à envoyer (à vérifier avant la clôture). */
export async function hasUnsyncedSales(sessionId: string): Promise<boolean> {
  const db = getOfflineDB();
  const count = await db.sales
    .where("sessionId")
    .equals(sessionId)
    .and((s) => s.syncStatus === "pending" || s.syncStatus === "syncing" || s.syncStatus === "failed")
    .count();
  return count > 0;
}

/**
 * Retourne les ventes offline non synchronisées.
 */
export async function getPendingOfflineSales(): Promise<OfflineSale[]> {
  const db = getOfflineDB();
  return db.sales.where("syncStatus").anyOf(["pending", "failed", "conflict"]).toArray();
}

/**
 * Retourne les dernières ventes (online + offline) pour affichage POS.
 */
export async function getRecentSales(limit = 20): Promise<OfflineSale[]> {
  const db = getOfflineDB();
  return db.sales
    .orderBy("createdAt")
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Génère ou récupère un identifiant unique pour ce device.
 */
export function getDeviceId(): string {
  let deviceId = localStorage.getItem("fishcore-device-id");
  if (!deviceId) {
    deviceId = generateIdempotencyKey();
    localStorage.setItem("fishcore-device-id", deviceId);
  }
  return deviceId;
}
