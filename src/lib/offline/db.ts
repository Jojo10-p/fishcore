import Dexie, { type Table } from "dexie";

// ─────────────────────────────────────────────
// Types IndexedDB (miroir simplifié du schéma Prisma)
// ─────────────────────────────────────────────

/** Conditionnement vendable (carton, boîte, pack…) : 1 conditionnement = factor × unité de base. */
export interface OfflinePackaging {
  unitId: string;
  name: string;
  symbol: string;
  factor: number;
  sellingPrice: number;
  barcode?: string;
}

/** Produit en cache local (format renvoyé par /api/products → offlineData). */
export interface OfflineProduct {
  id: string;
  name: string;
  internalCode?: string;
  barcode?: string;
  brand?: string;
  categoryName?: string;
  attributes?: Record<string, string>;
  sellingPrice: number;
  purchasePrice: number;
  taxRate: number;
  baseUnitId: string;
  baseUnitSymbol: string;
  allowsDecimal: boolean;
  trackBatches: boolean;
  requiresPrescription: boolean;
  stockAlertQty: number;
  isActive: boolean;
  packagings: OfflinePackaging[];
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
  customerName?: string;
  lines: OfflineSaleLine[];
  payments: OfflinePayment[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  notes?: string;
  /** Numéro de facture attribué par la caisse (imprimé sur le ticket). */
  invoiceSeq?: number;
  saleNumber?: string;
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
  quantity: number;         // dans l'unité vendue
  baseQuantity: number;     // dans l'unité de base (celle du stock et des réserves)
  unitId?: string;
  unitSymbol?: string;
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
 * Réserve de stock d'une session (miroir de StockReservation). Plus demandée à la
 * caisse depuis la synchronisation continue ; conservée pour les données existantes.
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

/** En-tête des tickets, gardé sur l'appareil pour imprimer sans connexion. */
export interface TicketHeader {
  company: {
    tradeName: string;
    legalName: string | null;
    phone: string;
    address: string | null;
    city: string | null;
    taxId: string | null;
    tradeRegNumber: string | null;
    currency: string;
    invoiceNotes: string | null;
    requiresPickup: boolean;
    invoiceFormat: string;
  };
  center: { id: string; name: string; address: string | null; city: string | null; phone: string | null };
  registerName: string;
  cashierFirstName: string;
  cashierRole?: string;
}

/** Numérotation des factures d'une session : plages confiées et numéros déjà utilisés. */
export interface OfflineNumbering {
  sessionId: string;
  blocks: Array<{ prefix: string; first: number; last: number }>;
  used: number[];
  header?: TicketHeader;
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
  numbering!: Table<OfflineNumbering>;

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

    // v3 : catalogue multi-métiers (conditionnements, TVA, lots) — on vide l'ancien
    // format de produits ; il est rechargé à la synchronisation suivante.
    this.version(3)
      .stores({ products: "id, barcode, internalCode, categoryName" })
      .upgrade((tx) => tx.table("products").clear());

    // v4 : numérotation des factures par la caisse (impression hors connexion)
    this.version(4).stores({ numbering: "sessionId" });
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
      // baseQuantity absent sur les ventes enregistrées avant la v3 : vendues en unité de base
      totals.set(line.productId, (totals.get(line.productId) ?? 0) + (line.baseQuantity ?? line.quantity));
    }
  }
  return totals;
}
