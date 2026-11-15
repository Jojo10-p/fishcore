import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCenterAccess, requireCompany, type AuthUser } from "@/lib/auth";
import { actorLabel, notifyManagers } from "@/lib/notify";
import { scheduleStockAlerts } from "@/lib/stock-alerts";
import { familyOf } from "@/lib/product-name";
import { hideSuggestion } from "@/lib/suggestions";

const D = Prisma.Decimal;

// ─────────────────────────────────────────────
// Modifier ou supprimer un article du stock (direction et gérant seulement)
// ─────────────────────────────────────────────
// Modifier : on saisit la quantité réellement présente ; l'écart est noté
// comme correction (historique, journal, notification à la direction).
// Supprimer : le stock de la boutique passe à 0 et l'article disparaît de la
// boutique ; ses ventes et réceptions passées restent dans l'historique.

const base = z.object({
  centerId: z.string().min(1),
  productId: z.string().min(1),
  reason: z.string().trim().min(3, "Motif obligatoire (min. 3 caractères)"),
});
const setSchema = base.extend({ quantity: z.coerce.number().min(0, "Quantité invalide") });

function requireEditor(user: AuthUser) {
  if (user.role !== "COMPANY_OWNER" && user.role !== "CENTER_MANAGER") {
    throw new ApiError(403, "Seuls la direction et le gérant peuvent modifier ou supprimer le stock", "FORBIDDEN");
  }
}

async function load(companyId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, companyId },
    select: { id: true, name: true, centerId: true, baseUnitId: true, trackBatches: true, baseUnit: { select: { allowsDecimal: true, symbol: true } } },
  });
  if (!product) throw new ApiError(404, "Article introuvable");
  return product;
}

/** Met la ligne de stock à `target` (verrouillée) et note l'écart. Renvoie l'ancienne et la nouvelle quantité. */
async function setQuantity(tx: Prisma.TransactionClient, user: AuthUser, centerId: string, product: Awaited<ReturnType<typeof load>>, target: Prisma.Decimal, reason: string) {
  await tx.stock.upsert({ where: { centerId_productId: { centerId, productId: product.id } }, create: { centerId, productId: product.id, quantity: 0 }, update: {} });
  const [row] = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal; reservedQty: Prisma.Decimal }[]>`
    SELECT "id", "quantity", "reservedQty" FROM "stocks" WHERE "centerId" = ${centerId} AND "productId" = ${product.id} FOR UPDATE`;
  const before = new D(row.quantity);
  if (target.lt(row.reservedQty)) {
    throw new ApiError(409, `${Number(row.reservedQty)} ${product.baseUnit.symbol} sont réservés pour des clients : la quantité ne peut pas descendre en dessous`, "RESERVED");
  }
  const delta = target.sub(before);
  if (delta.isZero()) return { before, after: before, movementId: null as string | null };
  await tx.stock.update({ where: { id: row.id }, data: { quantity: target, version: { increment: 1 } } });
  const movement = await tx.stockMovement.create({
    data: { stockId: row.id, type: "CORRECTION", quantity: delta, unitId: product.baseUnitId, referenceType: "Manual", notes: reason, performedById: user.id, centerId },
  });
  return { before, after: target, movementId: movement.id };
}

// POST /api/stock/edit — Fixer la quantité réelle d'un article dans la boutique
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    requireEditor(user);
    const companyId = requireCompany(user);
    const { centerId, productId, quantity, reason } = parseBody(setSchema, await readJson(req));
    await requireCenterAccess(user, centerId);
    const product = await load(companyId, productId);
    const target = new D(quantity);
    if (!product.baseUnit.allowsDecimal && !target.isInteger()) throw new ApiError(400, `Quantité entière attendue (${product.baseUnit.symbol})`, "INTEGER_QUANTITY");
    if (product.trackBatches) throw new ApiError(400, "Article suivi par lot : utilisez « Mouvement » pour préciser le lot", "BATCH_REQUIRED");

    const r = await prisma.$transaction(async (tx) => {
      const r = await setQuantity(tx, user, centerId, product, target, reason);
      if (r.movementId) {
        await writeAuditLog(
          {
            eventType: "STOCK_ADJUSTED",
            companyId,
            centerId,
            userId: user.id,
            referenceType: "StockMovement",
            referenceId: r.movementId,
            result: "SUCCESS",
            reason,
            oldValues: { quantity: r.before.toString() },
            newValues: { quantity: r.after.toString(), productId, via: "modifier" },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
      }
      return r;
    });

    if (r.movementId) {
      scheduleStockAlerts(companyId);
      notifyManagers({
        companyId,
        centerId,
        actorId: user.id,
        type: "STOCK_EDITED",
        title: "Stock modifié",
        message: `${await actorLabel(user.id)} : ${product.name}, ${Number(r.before)} → ${Number(r.after)} ${product.baseUnit.symbol}. Motif : ${reason}`,
        link: "/stock",
      });
    }
    return NextResponse.json({ success: true, data: { before: Number(r.before), after: Number(r.after) } });
  } catch (error) {
    return handleApiError(error, "STOCK/EDIT");
  }
}

// DELETE /api/stock/edit — Retirer un article de la boutique (stock à 0, l'historique reste)
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    requireEditor(user);
    const companyId = requireCompany(user);
    const { centerId, productId, reason } = parseBody(base, await readJson(req));
    await requireCenterAccess(user, centerId);
    const product = await load(companyId, productId);

    const r = await prisma.$transaction(async (tx) => {
      const r = await setQuantity(tx, user, centerId, product, new D(0), reason);
      // Article propre à cette boutique, ou plus en stock nulle part : il disparaît des listes
      const elsewhere = await tx.stock.count({ where: { productId, centerId: { not: centerId }, quantity: { gt: 0 } } });
      const archived = product.centerId === centerId || elsewhere === 0;
      if (archived) await tx.product.update({ where: { id: productId }, data: { isActive: false } });
      // Plus aucun format de cette famille dans la boutique : elle disparaît aussi de l'ajout de stock
      const fam = familyOf(product.name);
      const siblings = await tx.product.count({
        where: { companyId, isActive: true, id: { not: productId }, OR: [{ centerId }, { centerId: null }], name: { startsWith: fam, mode: "insensitive" } },
      });
      if (archived && siblings === 0) await hideSuggestion(tx, product.name, centerId);
      await writeAuditLog(
        {
          eventType: "STOCK_ADJUSTED",
          companyId,
          centerId,
          userId: user.id,
          referenceType: "Product",
          referenceId: productId,
          result: "SUCCESS",
          reason,
          oldValues: { quantity: r.before.toString(), isActive: true },
          newValues: { quantity: "0", isActive: !archived, via: "supprimer" },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return { ...r, archived };
    });

    scheduleStockAlerts(companyId);
    notifyManagers({
      companyId,
      centerId,
      actorId: user.id,
      type: "STOCK_EDITED",
      title: "Article supprimé du stock",
      message: `${await actorLabel(user.id)} : ${product.name} retiré (il en restait ${Number(r.before)} ${product.baseUnit.symbol}). Motif : ${reason}`,
      link: "/stock",
    });
    return NextResponse.json({ success: true, data: { archived: r.archived } });
  } catch (error) {
    return handleApiError(error, "STOCK/EDIT");
  }
}
