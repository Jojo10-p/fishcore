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
  syncStatus: "pending" | "syncing" | "synced" | "failed";
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

export interface SyncOperation {
  id: string;
  type: "sale" | "stock_update" | "cash_session";
  referenceId: string;
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "synced" | "failed";
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

  constructor() {
    super("fishcore-offline");

    this.version(1).stores({
      products: "id, barcode, internalCode, type, isActive",
      stocks: "id, centerId, productId",
      sales: "id, idempotencyKey, sessionId, centerId, syncStatus, createdAt",
      cashSessions: "id, cashRegisterId, isOpen",
      syncQueue: "id, type, status, createdAt",
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
