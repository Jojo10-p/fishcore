import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { notifyManagers } from "@/lib/notify";

// ─────────────────────────────────────────────
// Prix de vente quand le prix d'achat change
// ─────────────────────────────────────────────
// Hausse : le nouveau prix s'applique tout de suite à tout le stock (ancien compris).
// Baisse : l'ancien stock garde son prix ; la direction choisit le prix du nouveau
// stock (garder l'ancien, ou le prix proposé, ou un autre). Un prix plus bas
// passe à la caisse automatiquement quand l'ancien stock est vendu.

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export const packagingPriceSchema = z.array(z.object({ unitId: z.string().min(1), price: z.coerce.number().positive() })).max(10);
export type PackagingPrice = z.infer<typeof packagingPriceSchema>;

export const proposedPricesSchema = z
  .record(z.string(), z.object({ price: z.coerce.number().positive(), packagings: packagingPriceSchema.optional() }))
  .optional();
export type ProposedPrices = z.infer<typeof proposedPricesSchema>;

/** Change le prix de vente (et ceux des conditionnements) : historique + journal. */
export async function applyPrices(
  tx: Tx,
  p: { companyId: string; productId: string; price: number; packagings?: PackagingPrice | null; userId: string; reason: string }
) {
  const before = await tx.product.findUniqueOrThrow({ where: { id: p.productId }, select: { sellingPrice: true, purchasePrice: true, name: true } });
  const updated = await tx.product.update({
    where: { id: p.productId },
    data: { sellingPrice: p.price, pendingPrice: null, pendingPackagings: Prisma.DbNull, pendingPriceLeft: null },
  });
  for (const pk of p.packagings ?? []) {
    await tx.unitConversion.updateMany({ where: { productId: p.productId, fromUnitId: pk.unitId }, data: { sellingPrice: pk.price } });
  }
  await tx.productPriceHistory.create({ data: { productId: p.productId, purchasePrice: updated.purchasePrice, sellingPrice: updated.sellingPrice, changedById: p.userId } });
  await writeAuditLog(
    {
      eventType: "PRICE_CHANGED",
      companyId: p.companyId,
      userId: p.userId,
      referenceType: "Product",
      referenceId: p.productId,
      result: "SUCCESS",
      reason: p.reason,
      oldValues: { sellingPrice: before.sellingPrice.toString() },
      newValues: { sellingPrice: updated.sellingPrice.toString(), packagings: p.packagings ?? [] },
    },
    tx
  );
  return { name: before.name, from: Number(before.sellingPrice), to: p.price };
}

export interface CostDrop {
  productId: string;
  oldCost: Prisma.Decimal;
  newCost: Prisma.Decimal;
  oldQty: Prisma.Decimal;
}

/**
 * Après un arrivage. Pour chaque article dont le coût a baissé alors qu'il restait
 * de l'ancien stock : une décision est demandée à la direction. Les autres prix
 * proposés (hausse, ou pas de baisse du coût) s'appliquent tout de suite.
 */
export async function handleArrivalPrices(p: {
  companyId: string;
  centerId: string;
  receiptId: string;
  userId: string;
  drops: CostDrop[];
  proposed: ProposedPrices;
}) {
  const dropped = new Map(p.drops.map((d) => [d.productId, d]));
  const proposed = p.proposed ?? {};

  // Prix proposés sans baisse du coût : appliqués tout de suite
  const direct = Object.entries(proposed).filter(([id]) => !dropped.has(id));
  if (direct.length) {
    await prisma.$transaction(async (tx) => {
      for (const [productId, v] of direct) {
        await applyPrices(tx, { companyId: p.companyId, productId, price: v.price, packagings: v.packagings, userId: p.userId, reason: "Prix fixé à l'arrivage" });
      }
    });
  }

  if (!p.drops.length) return [];
  const products = await prisma.product.findMany({ where: { id: { in: [...dropped.keys()] } }, select: { id: true, name: true, sellingPrice: true, baseUnit: { select: { symbol: true } } } });
  const owners = await prisma.user.findMany({ where: { companyId: p.companyId, role: "COMPANY_OWNER", isActive: true }, select: { id: true } });
  const created = [];
  for (const prod of products) {
    const d = dropped.get(prod.id)!;
    const prop = proposed[prod.id];
    const decision = await prisma.priceDecision.create({
      data: {
        companyId: p.companyId,
        centerId: p.centerId,
        productId: prod.id,
        receiptId: p.receiptId,
        oldCost: d.oldCost.toDecimalPlaces(4),
        newCost: d.newCost.toDecimalPlaces(4),
        currentPrice: prod.sellingPrice,
        proposedPrice: prop && !new D(prop.price).equals(prod.sellingPrice) ? prop.price : null,
        proposedPackagings: prop?.packagings?.length ? (prop.packagings as Prisma.InputJsonValue) : undefined,
        oldQty: d.oldQty,
        proposedById: p.userId,
      },
    });
    created.push(decision);
    const unit = prod.baseUnit.symbol;
    const f = (n: Prisma.Decimal | number) => Math.round(Number(n)).toLocaleString("fr-FR");
    notifyManagers({
      companyId: p.companyId,
      centerId: p.centerId,
      actorId: p.userId,
      userIds: owners.map((o) => o.id),
      type: "PRICE_DECISION",
      title: `🏷️ ${prod.name} : acheté moins cher — quel prix de vente ?`,
      message:
        `Prix d'achat : ${f(d.oldCost)} F → ${f(d.newCost)} F le ${unit}. ` +
        `Il reste ${Number(d.oldQty).toLocaleString("fr-FR")} ${unit} de l'ancien stock, vendus à ${f(prod.sellingPrice)} F. ` +
        (decision.proposedPrice ? `Prix proposé pour le nouveau stock : ${f(decision.proposedPrice)} F. ` : "") +
        "Touchez pour choisir.",
      link: `/prix/${decision.id}`,
      data: { decisionId: decision.id, productId: prod.id },
    });
  }
  return created;
}

/** Ancien stock encore à vendre depuis l'arrivage (unité de base, toutes boutiques). */
async function oldStockLeft(tx: Tx, d: { productId: string; oldQty: Prisma.Decimal; createdAt: Date }) {
  const sold = await tx.saleLine.aggregate({
    where: { productId: d.productId, sale: { createdAt: { gte: d.createdAt }, status: { not: "CANCELLED" } } },
    _sum: { baseQuantity: true },
  });
  return new D(d.oldQty).sub(sold._sum.baseQuantity ?? 0);
}

export const decideSchema = z.object({
  price: z.coerce.number().positive("Prix invalide"),
  packagings: packagingPriceSchema.optional(),
});

/** La direction choisit le prix du nouveau stock. */
export async function decidePrice(p: { decisionId: string; companyId: string; userId: string; price: number; packagings?: PackagingPrice }) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.priceDecision.findFirst({ where: { id: p.decisionId, companyId: p.companyId } });
    if (!d) throw new ApiError(404, "Décision introuvable");
    if (d.status !== "PENDING") throw new ApiError(409, "Ce prix a déjà été choisi", "ALREADY_DECIDED");
    const product = await tx.product.findUniqueOrThrow({ where: { id: d.productId }, select: { sellingPrice: true } });
    const current = Number(product.sellingPrice);
    // Paquets proposés à l'arrivage : repris s'il choisit le prix proposé
    const packagings = p.packagings ?? (d.proposedPrice && Number(d.proposedPrice) === p.price ? ((d.proposedPackagings as PackagingPrice | null) ?? undefined) : undefined);

    let applied = false;
    let left = new D(0);
    if (p.price > current) {
      // Plus cher : tout le stock passe au nouveau prix tout de suite
      await applyPrices(tx, { companyId: p.companyId, productId: d.productId, price: p.price, packagings, userId: p.userId, reason: "Choix de la direction après un arrivage" });
      applied = true;
    } else if (p.price < current) {
      left = await oldStockLeft(tx, d);
      if (left.lte(0)) {
        await applyPrices(tx, { companyId: p.companyId, productId: d.productId, price: p.price, packagings, userId: p.userId, reason: "Ancien stock vendu : prix du nouveau stock" });
        applied = true;
      } else {
        await tx.product.update({
          where: { id: d.productId },
          data: { pendingPrice: p.price, pendingPackagings: (packagings ?? Prisma.DbNull) as Prisma.InputJsonValue, pendingPriceLeft: left },
        });
      }
    } else {
      applied = true; // on garde le prix actuel
    }
    await tx.priceDecision.update({
      where: { id: d.id },
      data: { status: "DECIDED", chosenPrice: p.price, decidedById: p.userId, decidedAt: new Date(), ...(applied ? { appliedAt: new Date() } : {}) },
    });
    return { applied, pendingUntilSold: applied ? null : Number(left) };
  });
}

/**
 * Après une vente : l'ancien stock diminue ; quand il est épuisé, le prix choisi
 * pour le nouveau stock passe à la caisse.
 */
export async function consumePendingPrices(companyId: string, lines: Array<{ productId: string; baseQuantity: Prisma.Decimal | number | string }>, userId: string) {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const pending = await prisma.product.findMany({ where: { id: { in: ids }, companyId, pendingPrice: { not: null } }, select: { id: true } });
  for (const { id } of pending) {
    const qty = lines.filter((l) => l.productId === id).reduce((s, l) => s.add(l.baseQuantity), new D(0));
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ pendingPriceLeft: Prisma.Decimal | null; pendingPrice: Prisma.Decimal | null; pendingPackagings: unknown }>>`
        UPDATE "products" SET "pendingPriceLeft" = "pendingPriceLeft" - ${qty.toString()}::numeric
         WHERE "id" = ${id} AND "pendingPrice" IS NOT NULL
     RETURNING "pendingPriceLeft", "pendingPrice", "pendingPackagings"`;
      const r = rows[0];
      if (!r?.pendingPrice || (r.pendingPriceLeft && new D(r.pendingPriceLeft).gt(0))) return;
      await applyPrices(tx, {
        companyId,
        productId: id,
        price: Number(r.pendingPrice),
        packagings: (r.pendingPackagings as PackagingPrice | null) ?? undefined,
        userId,
        reason: "Ancien stock vendu : prix du nouveau stock",
      });
      await tx.priceDecision.updateMany({ where: { productId: id, status: "DECIDED", appliedAt: null }, data: { appliedAt: new Date() } });
    });
  }
}
