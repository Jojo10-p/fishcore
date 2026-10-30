import { Prisma, StockMovementType } from "@prisma/client";
import { ApiError } from "@/lib/auth";
import { generateSaleNumber } from "@/lib/utils";

// ─────────────────────────────────────────────
// Mouvements de stock des inventaires et transferts
// ─────────────────────────────────────────────
// Toujours DANS une transaction. Le stock ne devient jamais négatif ni inférieur
// à la part réservée ; chaque mouvement est tracé (stock_movements).

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Numéro suivant d'un document de l'entreprise (INV-000001, TR-000001…), sans trou ni doublon. */
export async function nextCompanyNumber(
  tx: Tx,
  companyId: string,
  kind: "inventory" | "transfer"
): Promise<string> {
  const field = kind === "inventory" ? "inventoryCounter" : "transferCounter";
  const row = await tx.company.update({
    where: { id: companyId },
    data: { [field]: { increment: 1 } },
    select: { inventoryCounter: true, transferCounter: true },
  });
  const value = (kind === "inventory" ? row.inventoryCounter : row.transferCounter) - 1;
  return generateSaleNumber(kind === "inventory" ? "INV" : "TR", value);
}

/** Lot expédié lors d'un transfert (recréé tel quel à destination). */
export interface BatchSnapshot {
  lotNumber: string | null;
  expiresAt: string | null;
  quantity: string;
  unitCost: string | null;
}

/**
 * Sort `qty` des lots d'un produit.
 *  - "fefo"     : lots non périmés, le plus proche de la péremption d'abord ; refus si insuffisant
 *                 (on n'expédie pas de marchandise périmée).
 *  - "shrinkage": écart d'inventaire négatif — les périmés d'abord, puis FEFO ; si les lots
 *                 enregistrés ne suffisent pas, on sort ce qui existe (le stock fait foi).
 */
async function takeFromBatches(
  tx: Tx,
  p: { centerId: string; productId: string; qty: Decimal; productName: string; mode: "fefo" | "shrinkage" }
): Promise<Array<{ batchId: string; quantity: Decimal; snapshot: BatchSnapshot }>> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows = await tx.$queryRaw<
    Array<{ id: string; remainingQty: Prisma.Decimal; lotNumber: string | null; expiresAt: Date | null; unitCost: Prisma.Decimal | null }>
  >`
    SELECT "id", "remainingQty", "lotNumber", "expiresAt", "unitCost"
      FROM "batches"
     WHERE "productId" = ${p.productId} AND "centerId" = ${p.centerId} AND "remainingQty" > 0
     ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC, "id" ASC
       FOR UPDATE`;
  const expired = (b: (typeof rows)[number]) => b.expiresAt !== null && b.expiresAt < today;
  const ordered = p.mode === "fefo" ? rows.filter((b) => !expired(b)) : [...rows.filter(expired), ...rows.filter((b) => !expired(b))];

  let left = new D(p.qty);
  const taken: Array<{ batchId: string; quantity: Decimal; snapshot: BatchSnapshot }> = [];
  for (const b of ordered) {
    if (left.lte(0)) break;
    const take = D.min(left, new D(b.remainingQty));
    await tx.$executeRaw`UPDATE "batches" SET "remainingQty" = "remainingQty" - ${take.toString()}::numeric WHERE "id" = ${b.id}`;
    taken.push({
      batchId: b.id,
      quantity: take,
      snapshot: {
        lotNumber: b.lotNumber,
        expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
        quantity: take.toString(),
        unitCost: b.unitCost ? new D(b.unitCost).toString() : null,
      },
    });
    left = left.sub(take);
  }
  if (left.gt(0) && p.mode === "fefo") {
    throw new ApiError(409, `Lots non périmés insuffisants pour « ${p.productName} »`, "INSUFFICIENT_BATCH");
  }
  return taken;
}

export interface StockChange {
  centerId: string;
  productId: string;
  productName: string;
  unitId: string;
  trackBatches: boolean;
  /** Variation signée dans l'unité de base du produit. */
  delta: Decimal;
  type: StockMovementType;
  referenceType: string;
  referenceId: string;
  notes: string;
  userId: string;
  /** Entrée valorisée : le CMP du centre est recalculé avec ce coût unitaire. */
  incomingUnitCost?: Decimal;
  /** Sorties de lots : FEFO strict (transfert) ou démarque (inventaire). */
  batchMode?: "fefo" | "shrinkage";
  /** Entrée de lots : lots à recréer (transfert) ; sinon un lot unique `newLotNumber`. */
  incomingBatches?: BatchSnapshot[];
  newLotNumber?: string;
}

/**
 * Applique une variation de stock tracée. Renvoie la quantité avant/après,
 * le CMP utilisé et, pour une sortie de produit suivi par lot, les lots sortis.
 */
export async function applyStockChange(
  tx: Tx,
  c: StockChange
): Promise<{ before: Decimal; after: Decimal; avgCost: Decimal; batchesOut: BatchSnapshot[] }> {
  if (c.delta.isZero()) {
    const s = await tx.stock.findUnique({ where: { centerId_productId: { centerId: c.centerId, productId: c.productId } } });
    const q = s ? new D(s.quantity) : new D(0);
    return { before: q, after: q, avgCost: s ? new D(s.avgCost) : new D(0), batchesOut: [] };
  }

  await tx.stock.upsert({
    where: { centerId_productId: { centerId: c.centerId, productId: c.productId } },
    create: { centerId: c.centerId, productId: c.productId, quantity: 0 },
    update: {},
  });
  const [row] = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal; reservedQty: Prisma.Decimal; avgCost: Prisma.Decimal }[]>`
    SELECT "id", "quantity", "reservedQty", "avgCost" FROM "stocks"
     WHERE "centerId" = ${c.centerId} AND "productId" = ${c.productId} FOR UPDATE`;
  const before = new D(row.quantity);
  const after = before.add(c.delta);
  if (after.lt(row.reservedQty)) {
    throw new ApiError(409, `Stock insuffisant pour « ${c.productName} »`, "INSUFFICIENT_STOCK");
  }

  // CMP : une entrée valorisée le recalcule, le reste le conserve
  let avgCost = new D(row.avgCost);
  if (c.delta.gt(0) && c.incomingUnitCost && c.incomingUnitCost.gt(0)) {
    const base = D.max(before, 0);
    avgCost = base.lte(0) || avgCost.lte(0) ? c.incomingUnitCost : base.mul(avgCost).add(c.delta.mul(c.incomingUnitCost)).div(base.add(c.delta));
  }

  await tx.$executeRaw`
    UPDATE "stocks"
       SET "quantity" = "quantity" + ${c.delta.toString()}::numeric,
           "avgCost" = ${avgCost.toDecimalPlaces(4).toString()}::numeric,
           "version" = "version" + 1,
           "updatedAt" = NOW()
     WHERE "id" = ${row.id}`;

  const base = {
    stockId: row.id,
    type: c.type,
    unitId: c.unitId,
    referenceType: c.referenceType,
    referenceId: c.referenceId,
    notes: c.notes,
    performedById: c.userId,
    centerId: c.centerId,
  };

  let batchesOut: BatchSnapshot[] = [];
  if (!c.trackBatches) {
    await tx.stockMovement.create({ data: { ...base, quantity: c.delta } });
  } else if (c.delta.lt(0)) {
    const taken = await takeFromBatches(tx, {
      centerId: c.centerId,
      productId: c.productId,
      qty: c.delta.abs(),
      productName: c.productName,
      mode: c.batchMode ?? "fefo",
    });
    batchesOut = taken.map((t) => t.snapshot);
    const rest = taken.reduce((s, t) => s.sub(t.quantity), c.delta.abs());
    await tx.stockMovement.createMany({
      data: [
        ...taken.map((t) => ({ ...base, quantity: t.quantity.negated(), batchId: t.batchId })),
        ...(rest.gt(0) ? [{ ...base, quantity: rest.negated() }] : []),
      ],
    });
  } else {
    const lots: BatchSnapshot[] =
      c.incomingBatches && c.incomingBatches.length > 0
        ? c.incomingBatches
        : [{ lotNumber: c.newLotNumber ?? null, expiresAt: null, quantity: c.delta.toString(), unitCost: avgCost.toString() }];
    // Les lots reçus ne dépassent jamais la quantité entrée (réception partielle d'un transfert)
    let left = new D(c.delta);
    for (const lot of lots) {
      if (left.lte(0)) break;
      const qty = D.min(left, new D(lot.quantity));
      const batch = await tx.batch.create({
        data: {
          productId: c.productId,
          centerId: c.centerId,
          initialQty: qty,
          remainingQty: qty,
          unitCost: lot.unitCost ? new D(lot.unitCost) : avgCost,
          lotNumber: lot.lotNumber,
          expiresAt: lot.expiresAt ? new Date(lot.expiresAt) : null,
          notes: c.notes,
        },
      });
      await tx.stockMovement.create({ data: { ...base, quantity: qty, batchId: batch.id } });
      left = left.sub(qty);
    }
    if (left.gt(0)) await tx.stockMovement.create({ data: { ...base, quantity: left } });
  }

  return { before, after, avgCost, batchesOut };
}
