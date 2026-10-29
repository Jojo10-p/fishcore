import Dexie, { type Table } from "dexie";

// ─────────────────────────────────────────────
// Types IndexedDB (miroir simplifié du schéma Prisma)
// ─────────────────────────────────────────────

export interface OfflineProduct {
  id: string;
  name: string;
  internalCode?: string;
  barcode?: string;
  species?: string;
  type: string;
  sellingPrice: number;
  purchasePrice: number;
  baseUnitId: string;
  baseUnitSymbol: string;
  stockAlertQty: number;
  isActive: boolean;
}

export interface OfflineStock {
  id: string; // centerId_productId
  centerId: string;
  productId: string;
  quantity: number;
  reservedQty: number;
  version: number;
  lastSyncedAt: string; // ISO string
}

export interface OfflineSale {
  id: string; // idempotencyKey (UUID local)
  idempotencyKey: string;
  sessionId: string;
  cashierId: string;
  centerId: string;
  companyId: string;
  customerId?: string;
  lines: OfflineSaleLine[];
  payments: OfflinePayment[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  notes?: string;
  createdAt: string; // ISO string
  // conflict = refusée par le serveur pour une raison métier (stock, prix, session clôturée) :
  // ne sera pas retentée automatiquement, un responsable doit la traiter.
  syncStatus: "pending" | "syncing" | "synced" | "failed" | "conflict";
  syncError?: string;
  syncedAt?: string;
  retryCount: number;
}

export interface OfflineSaleLine {
  productId: string;
  productName: string;
  quantity: number;
  unitId?: string;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}

export interface OfflinePayment {
  method: string;
  amount: number;
  reference?: string;
}

export interface OfflineCashSession {
  id: string;
  cashRegisterId: string;
  cashierName: string;
  openedAt: string;
  openingBalance: number;
  isOpen: boolean;
}

/**
 * Réserve hors ligne de la session de caisse (miroir de StockReservation).
 * serverQuantity = valeur confirmée par le serveur à la dernière synchro ;
 * le disponible local = serverQuantity − ventes hors ligne non encore confirmées.
 */
export interface OfflineReservation {
  id: string; // sessionId_productId
  sessionId: string;
  productId: string;
  serverQuantity: number;
  lastSyncedAt: string;
}

/** Brouillon de formulaire sauvegardé au fil de la saisie (cahier §11.1). */
export interface OfflineDraft {
  key: string; // ex. "goods-receipt:<centerId>"
  data: unknown;
  updatedAt: string;
}

export interface SyncOperation {
  id: string;
  type: "sale" | "stock_update" | "cash_session";
  referenceId: string;
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "synced" | "failed" | "conflict";
  createdAt: string;
  attemptCount: number;
  lastAttemptAt?: string;
  error?: string;
}

// ─────────────────────────────────────────────
// Classe Dexie
// ─────────────────────────────────────────────

export class FishcoreOfflineDB extends Dexie {
  products!: Table<OfflineProduct>;
  stocks!: Table<OfflineStock>;
  sales!: Table<OfflineSale>;
  cashSessions!: Table<OfflineCashSession>;
  syncQueue!: Table<SyncOperation>;
  reservations!: Table<OfflineReservation>;
  drafts!: Table<OfflineDraft>;

  constructor() {
    super("fishcore-offline");

    this.version(1).stores({
      products: "id, barcode, internalCode, type, isActive",
      stocks: "id, centerId, productId",
      sales: "id, idempotencyKey, sessionId, centerId, syncStatus, createdAt",
      cashSessions: "id, cashRegisterId, isOpen",
      syncQueue: "id, type, status, createdAt",
    });

    // v2 : réserves hors ligne par session + brouillons de formulaires
    this.version(2).stores({
      reservations: "id, sessionId, productId",
      drafts: "key, updatedAt",
    });
  }
}

// Singleton
let _db: FishcoreOfflineDB | null = null;

export function getOfflineDB(): FishcoreOfflineDB {
  if (typeof window === "undefined") {
    throw new Error("getOfflineDB() ne peut être appelé que côté client");
  }
  if (!_db) {
    _db = new FishcoreOfflineDB();
  }
  return _db;
}

/** Statuts d'une vente locale pas encore confirmée par le serveur. */
export const UNCONFIRMED_STATUSES = ["pending", "syncing", "failed", "conflict"] as const;

/**
 * Quantités vendues hors ligne et pas encore confirmées par le serveur,
 * par produit (optionnellement pour une seule session de caisse).
 */
export async function getUnconfirmedQuantities(sessionId?: string): Promise<Map<string, number>> {
  const db = getOfflineDB();
  const sales = await db.sales.where("syncStatus").anyOf([...UNCONFIRMED_STATUSES]).toArray();
  const totals = new Map<string, number>();
  for (const sale of sales) {
    if (sessionId && sale.sessionId !== sessionId) continue;
    for (const line of sale.lines) {
      totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
    }
  }
  return totals;
}
