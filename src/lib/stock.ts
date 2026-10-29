import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/auth";

// ─────────────────────────────────────────────
// Opérations de stock atomiques (cahier §8.4, §9.2, §9.4)
// ─────────────────────────────────────────────
// Toutes ces fonctions s'exécutent DANS une transaction et reposent sur des
// mises à jour SQL conditionnelles : la base est seule juge de la disponibilité.
//
// Invariants (aussi garantis par prisma/sql/integrity-guards.sql) :
//   0 <= reservedQty <= quantity
//   reservedQty = somme des réserves des sessions de caisse

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Sort `qty` du stock pour une vente rattachée à `sessionId`.
 * Consomme d'abord la réserve de cette session, puis le stock libre.
 * Lève 409 INSUFFICIENT_STOCK sinon — sauf `regularizeShortfall` : vente déjà
 * faite hors connexion, la marchandise est partie. Le stock enregistré était
 * donc trop bas ; l'écart est d'abord régularisé (renvoyé dans `regularized`,
 * à tracer par l'appelant), puis la vente est sortie.
 */
export async function consumeStockForSale(
  tx: Tx,
  params: {
    centerId: string;
    productId: string;
    qty: Decimal;
    sessionId: string;
    productName: string;
    trackBatches?: boolean;
    regularizeShortfall?: boolean;
  }
): Promise<{ stockId: string; fromReservation: Decimal; allocations: BatchAllocation[]; avgCost: Decimal; regularized: Decimal }> {
  const { centerId, productId, qty, sessionId, productName, trackBatches = false } = params;
  // Produits suivis par lot : un écart ne se régularise pas sans n° de lot
  const regularize = !!params.regularizeShortfall && !trackBatches;

  if (regularize) {
    await tx.$executeRaw`
      INSERT INTO "stocks" ("id", "centerId", "productId", "quantity", "reservedQty", "avgCost", "version", "updatedAt")
      VALUES (md5(random()::text || clock_timestamp()::text), ${centerId}, ${productId}, 0, 0, 0, 0, NOW())
      ON CONFLICT ("centerId", "productId") DO NOTHING`;
  }

  // Verrouille la ligne de stock (sérialise les ventes concurrentes du produit)
  const stocks = await tx.$queryRaw<{ id: string; avgCost: Prisma.Decimal; quantity: Prisma.Decimal; reservedQty: Prisma.Decimal }[]>`
    SELECT "id", "avgCost", "quantity", "reservedQty" FROM "stocks" WHERE "centerId" = ${centerId} AND "productId" = ${productId} FOR UPDATE`;
  if (stocks.length === 0) {
    throw new ApiError(409, `Stock insuffisant pour « ${productName} »`, "INSUFFICIENT_STOCK");
  }
  const stockId = stocks[0].id;

  // 1. Part prise sur la réserve de la session
  const reservations = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal }[]>`
    SELECT "id", "quantity" FROM "stock_reservations"
     WHERE "sessionId" = ${sessionId} AND "stockId" = ${stockId} FOR UPDATE`;
  const reserved = reservations[0] ? new D(reservations[0].quantity) : new D(0);
  const fromReservation = D.min(reserved, qty);
  const fromFree = qty.sub(fromReservation);

  if (fromReservation.gt(0)) {
    await tx.$executeRaw`
      UPDATE "stock_reservations"
         SET "quantity" = "quantity" - ${fromReservation.toString()}::numeric, "updatedAt" = NOW()
       WHERE "id" = ${reservations[0].id}`;
  }

  // 1b. Vente hors connexion au-delà du stock enregistré : l'écart est remis
  //     d'abord (ajustement tracé par l'appelant), la vente passe ensuite
  let regularized = new D(0);
  if (regularize) {
    const free = new D(stocks[0].quantity).sub(stocks[0].reservedQty);
    if (fromFree.gt(free)) {
      regularized = fromFree.sub(free);
      await tx.$executeRaw`
        UPDATE "stocks" SET "quantity" = "quantity" + ${regularized.toString()}::numeric, "updatedAt" = NOW() WHERE "id" = ${stockId}`;
    }
  }

  // 2. Sortie : la part réservée diminue quantity ET reservedQty ; la part libre
  //    n'est acceptée que si le stock non réservé suffit.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "stocks"
       SET "quantity" = "quantity" - ${qty.toString()}::numeric,
           "reservedQty" = "reservedQty" - ${fromReservation.toString()}::numeric,
           "version" = "version" + 1,
           "updatedAt" = NOW()
     WHERE "id" = ${stockId}
       AND "quantity" - "reservedQty" >= ${fromFree.toString()}::numeric
 RETURNING "id"`;
  if (rows.length === 0) {
    throw new ApiError(409, `Stock insuffisant pour « ${productName} »`, "INSUFFICIENT_STOCK");
  }

  // 3. Produits suivis par lot : sortie des lots non périmés, le plus proche de la péremption d'abord
  const allocations = trackBatches ? await allocateBatchesFefo(tx, { centerId, productId, qty, productName }) : [];

  return { stockId, fromReservation, allocations, avgCost: new D(stocks[0].avgCost), regularized };
}

export interface BatchAllocation {
  batchId: string;
  quantity: Decimal;
  unitCost: Decimal | null;
  lotNumber: string | null;
  expiresAt: Date | null;
}

/** Début du jour courant (UTC) : un lot qui expire aujourd'hui n'est plus vendable demain. */
function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Prélève `qty` sur les lots du produit selon la règle FEFO (premier périmé,
 * premier sorti). Les lots périmés ne sont JAMAIS vendus : s'il ne reste que
 * du périmé, la vente est refusée (le stock périmé se sort en « détérioration »).
 */
export async function allocateBatchesFefo(
  tx: Tx,
  params: { centerId: string; productId: string; qty: Decimal; productName: string }
): Promise<BatchAllocation[]> {
  const { centerId, productId, qty, productName } = params;
  const today = startOfToday();

  const batches = await tx.$queryRaw<
    Array<{ id: string; remainingQty: Prisma.Decimal; lotNumber: string | null; expiresAt: Date | null; unitCost: Prisma.Decimal | null }>
  >`
    SELECT "id", "remainingQty", "lotNumber", "expiresAt", "unitCost"
      FROM "batches"
     WHERE "productId" = ${productId} AND "centerId" = ${centerId}
       AND "remainingQty" > 0
       AND ("expiresAt" IS NULL OR "expiresAt" >= ${today})
     ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC, "id" ASC
       FOR UPDATE`;

  let left = new D(qty);
  const allocations: BatchAllocation[] = [];
  for (const b of batches) {
    if (left.lte(0)) break;
    const take = D.min(left, new D(b.remainingQty));
    await tx.$executeRaw`
      UPDATE "batches" SET "remainingQty" = "remainingQty" - ${take.toString()}::numeric WHERE "id" = ${b.id}`;
    allocations.push({
      batchId: b.id,
      quantity: take,
      unitCost: b.unitCost !== null ? new D(b.unitCost) : null,
      lotNumber: b.lotNumber,
      expiresAt: b.expiresAt,
    });
    left = left.sub(take);
  }

  if (left.gt(0)) {
    throw new ApiError(
      409,
      `Stock non périmé insuffisant pour « ${productName} » (il manque ${left.toString()}). Retirez les lots périmés du stock.`,
      "EXPIRED_STOCK"
    );
  }
  return allocations;
}

/** Remet une quantité dans un lot (annulation, retour client, ajustement positif). */
export async function restoreBatch(tx: Tx, batchId: string, qty: Decimal) {
  await tx.$executeRaw`
    UPDATE "batches" SET "remainingQty" = "remainingQty" + ${qty.toString()}::numeric WHERE "id" = ${batchId}`;
}

/**
 * Fixe la réserve d'une session pour un produit à `target` (valeur absolue).
 * Augmenter n'est possible que dans la limite du stock non réservé :
 * la somme des réserves de toutes les caisses ne dépasse jamais le stock réel.
 */
export async function setSessionReservation(
  tx: Tx,
  params: { sessionId: string; stockId: string; target: Decimal; productName: string }
): Promise<{ previous: Decimal; current: Decimal }> {
  const { sessionId, stockId, target, productName } = params;
  if (target.lt(0)) throw new ApiError(400, "Réserve négative impossible");

  await tx.$queryRaw`SELECT "id" FROM "stocks" WHERE "id" = ${stockId} FOR UPDATE`;
  const existing = await tx.stockReservation.findUnique({
    where: { sessionId_stockId: { sessionId, stockId } },
  });
  const previous = existing ? new D(existing.quantity) : new D(0);
  const delta = target.sub(previous);

  if (!delta.isZero()) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "stocks"
         SET "reservedQty" = "reservedQty" + ${delta.toString()}::numeric,
             "version" = "version" + 1,
             "updatedAt" = NOW()
       WHERE "id" = ${stockId}
         AND "quantity" - "reservedQty" >= ${delta.toString()}::numeric
   RETURNING "id"`;
    if (rows.length === 0) {
      throw new ApiError(409, `Stock disponible insuffisant pour réserver « ${productName} »`, "INSUFFICIENT_STOCK");
    }
  }

  if (existing) {
    await tx.stockReservation.update({ where: { id: existing.id }, data: { quantity: target } });
  } else if (target.gt(0)) {
    await tx.stockReservation.create({ data: { sessionId, stockId, quantity: target } });
  }

  return { previous, current: target };
}

/**
 * Rend au stock libre tout ce qui reste réservé pour une session
 * (appelé à la clôture de la caisse).
 */
export async function releaseSessionReservations(tx: Tx, sessionId: string): Promise<Array<{ stockId: string; released: string }>> {
  const reservations = await tx.stockReservation.findMany({
    where: { sessionId, quantity: { gt: 0 } },
    orderBy: { stockId: "asc" }, // ordre fixe : évite les interblocages
  });
  const released: Array<{ stockId: string; released: string }> = [];
  for (const r of reservations) {
    await tx.$executeRaw`
      UPDATE "stocks"
         SET "reservedQty" = "reservedQty" - ${r.quantity.toString()}::numeric,
             "version" = "version" + 1, "updatedAt" = NOW()
       WHERE "id" = ${r.stockId}`;
    await tx.stockReservation.update({ where: { id: r.id }, data: { quantity: 0 } });
    released.push({ stockId: r.stockId, released: r.quantity.toString() });
  }
  return released;
}

/**
 * Entrée en stock valorisée (réception) : met à jour la quantité et le coût
 * moyen pondéré (CMP) du stock.
 *   nouveau CMP = (stock × CMP + entrée × coût d'entrée) / (stock + entrée)
 */
export async function receiveIntoStock(
  tx: Tx,
  params: { centerId: string; productId: string; qty: Decimal; unitCost: Decimal }
): Promise<{ stockId: string; avgCost: Decimal }> {
  const { centerId, productId, qty, unitCost } = params;
  await tx.stock.upsert({
    where: { centerId_productId: { centerId, productId } },
    create: { centerId, productId, quantity: 0 },
    update: {},
  });
  const [row] = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal; avgCost: Prisma.Decimal }[]>`
    SELECT "id", "quantity", "avgCost" FROM "stocks"
     WHERE "centerId" = ${centerId} AND "productId" = ${productId} FOR UPDATE`;
  const oldQty = Prisma.Decimal.max(new D(row.quantity), 0);
  const newQty = oldQty.add(qty);
  const avgCost = oldQty.lte(0) || new D(row.avgCost).lte(0)
    ? unitCost
    : oldQty.mul(row.avgCost).add(qty.mul(unitCost)).div(newQty);
  await tx.$executeRaw`
    UPDATE "stocks"
       SET "quantity" = "quantity" + ${qty.toString()}::numeric,
           "avgCost" = ${avgCost.toDecimalPlaces(4).toString()}::numeric,
           "version" = "version" + 1,
           "updatedAt" = NOW()
     WHERE "id" = ${row.id}`;
  return { stockId: row.id, avgCost };
}

/**
 * Répartit les frais annexes (transport, glace, manutention…) sur les lignes
 * d'une réception au prorata de leur valeur (ou de leur quantité si la
 * marchandise est gratuite) → coût de revient unitaire de chaque ligne.
 */
export function landedUnitCosts(
  lines: Array<{ quantity: Prisma.Decimal; totalPrice: Prisma.Decimal }>,
  fees: Prisma.Decimal
): Decimal[] {
  const totalValue = lines.reduce((s, l) => s.add(l.totalPrice), new D(0));
  const totalQty = lines.reduce((s, l) => s.add(l.quantity), new D(0));
  return lines.map((l) => {
    const share = fees.isZero()
      ? new D(0)
      : totalValue.gt(0)
        ? fees.mul(l.totalPrice).div(totalValue)
        : fees.mul(l.quantity).div(totalQty);
    return new D(l.totalPrice).add(share).div(l.quantity).toDecimalPlaces(4);
  });
}

