"use client";

import Dexie from "dexie";
import { getOfflineDB, type OfflineSale, type OfflineSaleLine, type OfflinePayment } from "./db";
import { queueSaleForSync } from "./sync";
import { commitNumber } from "./numbering";
import { generateIdempotencyKey } from "@/lib/utils";

interface CreateOfflineSaleParams {
  sessionId: string;
  cashierId: string;
  centerId: string;
  companyId: string;
  customerId?: string;
  customerName?: string;
  lines: OfflineSaleLine[];
  payments: OfflinePayment[];
  notes?: string;
  /** Clé déjà utilisée pour une tentative en ligne (repli hors ligne sans doublon). */
  idempotencyKey?: string;
  /** Numéro de facture pris dans la plage de la caisse (imprimé sur le ticket). */
  invoice?: { seq: number; saleNumber: string };
}

/**
 * Stock local du centre (dernier état reçu du serveur, moins les ventes de cet
 * appareil pas encore confirmées) : affiché à la caisse, sert d'alerte hors ligne.
 */
export async function getLocalStock(centerId: string): Promise<Map<string, number>> {
  const db = getOfflineDB();
  const rows = await db.stocks.where("centerId").equals(centerId).toArray();
  return new Map(rows.map((r) => [r.productId, r.quantity]));
}

/**
 * Crée une vente hors connexion (cahier §9.4).
 * La caisse vend comme en ligne : la marchandise est devant le client. Si le
 * stock local paraît insuffisant, la vente passe quand même (avertissement) ;
 * à l'envoi, le serveur régularise l'écart et le trace pour l'inventaire.
 * La vente, son numéro et son opération de synchronisation sont écrits dans la
 * même transaction locale (une coupure de courant ne peut pas les séparer).
 */
export async function createOfflineSale(params: CreateOfflineSaleParams): Promise<{
  success: boolean;
  saleId?: string;
  error?: string;
  /** Articles vendus au-delà du stock local connu (à vérifier à l'inventaire). */
  shortfalls?: string[];
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
  const shortfalls: string[] = [];
  try {
    await db.transaction("rw", [db.stocks, db.sales, db.syncQueue, db.numbering], async () => {
      // Stock local du centre : diminué tout de suite (la vérité reste côté serveur)
      for (const [productId, { qty, name }] of requested) {
        const stockId = `${params.centerId}_${productId}`;
        const stock = await db.stocks.get(stockId);
        if (!stock || stock.quantity < qty) shortfalls.push(name);
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
        customerName: params.customerName,
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
        customerName: params.customerName,
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

  return { success: true, saleId: idempotencyKey, shortfalls };
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

/**
 * Vente confirmée en ligne : le stock local du centre baisse tout de suite
 * (affichage et ventes hors ligne à venir), sans attendre le prochain relevé.
 */
export async function applySaleToLocalStock(centerId: string, lines: Array<{ productId: string; baseQuantity: number }>) {
  const db = getOfflineDB();
  await Dexie.ignoreTransaction(() =>
    db.transaction("rw", db.stocks, async () => {
      for (const l of lines) {
        const id = `${centerId}_${l.productId}`;
        const stock = await db.stocks.get(id);
        if (stock) await db.stocks.update(id, { quantity: Math.max(0, stock.quantity - l.baseQuantity) });
      }
    })
  );
}
