"use client";

import { getOfflineDB, type OfflineSale, type OfflineSaleLine, type OfflinePayment } from "./db";
import { queueSaleForSync } from "./sync";
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
}

/**
 * Crée une vente en mode offline.
 * Vérifie le stock local et met à jour IndexedDB.
 */
export async function createOfflineSale(params: CreateOfflineSaleParams): Promise<{
  success: boolean;
  saleId?: string;
  error?: string;
}> {
  const db = getOfflineDB();

  const idempotencyKey = generateIdempotencyKey();

  // Calculer les totaux
  const subtotal = params.lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const discountAmount = params.lines.reduce((sum, l) => sum + l.discount * l.quantity, 0);
  const totalAmount = subtotal - discountAmount;

  // Vérifier et réserver le stock local
  const stockUpdates: Array<{ id: string; newQuantity: number; newReservedQty: number }> = [];

  for (const line of params.lines) {
    const stockId = `${params.centerId}_${line.productId}`;
    const stock = await db.stocks.get(stockId);

    if (!stock) {
      return {
        success: false,
        error: `Stock introuvable pour le produit "${line.productName}". Synchronisez les données.`,
      };
    }

    const available = stock.quantity - stock.reservedQty;
    if (available < line.quantity) {
      return {
        success: false,
        error: `Stock insuffisant pour "${line.productName}" : disponible ${available}, demandé ${line.quantity}.`,
      };
    }

    stockUpdates.push({
      id: stockId,
      newQuantity: stock.quantity - line.quantity,
      newReservedQty: stock.reservedQty,
    });
  }

  // Appliquer les mises à jour de stock
  await db.transaction("rw", db.stocks, db.sales, db.syncQueue, async () => {
    // Mettre à jour stocks
    for (const update of stockUpdates) {
      await db.stocks.update(update.id, {
        quantity: update.newQuantity,
        reservedQty: update.newReservedQty,
      });
    }

    // Créer la vente offline
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
      createdAt: new Date().toISOString(),
      syncStatus: "pending",
      retryCount: 0,
    };

    await db.sales.add(sale);
  });

  // Ajouter à la file de sync
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
    createdOffline: true,
    deviceId: getDeviceId(),
  });

  return { success: true, saleId: idempotencyKey };
}

/**
 * Retourne les ventes offline non synchronisées.
 */
export async function getPendingOfflineSales(): Promise<OfflineSale[]> {
  const db = getOfflineDB();
  return db.sales.where("syncStatus").anyOf(["pending", "failed"]).toArray();
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
