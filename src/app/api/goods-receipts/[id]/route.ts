import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { goodsReceiptSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCenterAccess, requireCompany, type AuthUser } from "@/lib/auth";
import { landedUnitCosts, receiveIntoStock } from "@/lib/stock";
import { scheduleStockAlerts } from "@/lib/stock-alerts";
import { actorLabel, notifyManagers } from "@/lib/notify";

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

// ─────────────────────────────────────────────
// Modifier un arrivage déjà enregistré (direction et gérant)
// ─────────────────────────────────────────────
// Tout se change : fournisseur, date, frais, articles (y compris le format),
// quantités, prix. Le stock est corrigé de la différence, article par article ;
// ce qui a déjà été vendu ne peut pas être retiré. Tout reste dans l'historique.

function requireEditor(user: AuthUser) {
  if (user.role !== "COMPANY_OWNER" && user.role !== "CENTER_MANAGER") {
    throw new ApiError(403, "Seuls la direction et le gérant peuvent modifier un arrivage", "FORBIDDEN");
  }
}

const sumBy = (lines: Array<{ productId: string; quantity: Prisma.Decimal.Value }>) => {
  const m = new Map<string, Dec>();
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? new D(0)).add(l.quantity));
  return m;
};

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    requireEditor(user);
    const companyId = requireCompany(user);
    const { id } = await params;
    const data = parseBody(goodsReceiptSchema, await readJson(req));

    const receipt = await prisma.goodsReceipt.findFirst({
      where: { id, center: { companyId } },
      include: { lines: { select: { productId: true, quantity: true } }, purchase: { select: { id: true, paidAmount: true } } },
    });
    if (!receipt) throw new ApiError(404, "Arrivage introuvable");
    await requireCenterAccess(user, receipt.centerId);
    if (data.centerId !== receipt.centerId) throw new ApiError(400, "L'arrivage reste dans sa boutique");

    const productIds = [...new Set(data.lines.map((l) => l.productId))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId }, select: { id: true, name: true, baseUnitId: true, trackBatches: true, baseUnit: { select: { symbol: true } } } });
    if (products.length !== productIds.length) throw new ApiError(400, "Article invalide dans l'arrivage");
    const pById = new Map(products.map((p) => [p.id, p]));
    if (data.supplierId) {
      const s = await prisma.supplier.findFirst({ where: { id: data.supplierId, companyId }, select: { id: true } });
      if (!s) throw new ApiError(400, "Fournisseur introuvable");
    }

    const oldBy = sumBy(receipt.lines);
    const newBy = sumBy(data.lines);
    const fees = new D(data.transportCost).add(data.iceCost).add(data.handlingCost).add(data.otherCosts);
    const newLines = data.lines.map((l) => ({ ...l, quantity: new D(l.quantity), totalPrice: new D(l.totalPrice) }));
    const unitCosts = landedUnitCosts(newLines, fees);
    // Coût de revient moyen par article (plusieurs lignes possibles pour un même article)
    const costBy = new Map<string, Dec>();
    newLines.forEach((l, i) => {
      const q = newBy.get(l.productId)!;
      costBy.set(l.productId, (costBy.get(l.productId) ?? new D(0)).add(unitCosts[i].mul(l.quantity).div(q.isZero() ? 1 : q)));
    });
    const changes: string[] = [];

    await prisma.$transaction(async (tx) => {
      if (receipt.isValidated) {
        const batches = await tx.batch.findMany({ where: { receiptId: id }, orderBy: { receivedAt: "asc" } });
        for (const productId of new Set([...oldBy.keys(), ...newBy.keys()])) {
          const before = oldBy.get(productId) ?? new D(0);
          const after = newBy.get(productId) ?? new D(0);
          const delta = after.sub(before);
          const unitCost = costBy.get(productId) ?? new D(0);
          const mine = batches.filter((b) => b.productId === productId);
          const name = pById.get(productId)?.name ?? (await tx.product.findUnique({ where: { id: productId }, select: { name: true } }))?.name ?? "article";

          if (!delta.isZero()) {
            let stockId: string;
            if (delta.gt(0)) {
              stockId = (await receiveIntoStock(tx, { centerId: receipt.centerId, productId, qty: delta, unitCost })).stockId;
            } else {
              const rows = await tx.$queryRaw<{ id: string }[]>`
                UPDATE "stocks" SET "quantity" = "quantity" + ${delta.toString()}::numeric, "version" = "version" + 1, "updatedAt" = NOW()
                 WHERE "centerId" = ${receipt.centerId} AND "productId" = ${productId}
                   AND "quantity" + ${delta.toString()}::numeric >= "reservedQty"
             RETURNING "id"`;
              if (!rows.length) throw new ApiError(409, `« ${name} » : une partie a déjà été vendue, on ne peut pas retirer ${Number(delta.neg())} du stock`, "ALREADY_SOLD");
              stockId = rows[0].id;
            }
            // Les lots de cet arrivage suivent (ce qui est vendu reste vendu)
            if (delta.gt(0)) {
              if (mine[0]) await tx.batch.update({ where: { id: mine[0].id }, data: { remainingQty: { increment: delta }, initialQty: new D(mine[0].initialQty ?? 0).add(delta) } });
              else
                await tx.batch.create({
                  data: { receiptId: id, productId, centerId: receipt.centerId, initialQty: delta, remainingQty: delta, unitCost, receivedAt: data.receivedAt },
                });
            } else {
              let left = delta.neg();
              for (const b of mine) {
                if (left.isZero()) break;
                const take = Prisma.Decimal.min(left, b.remainingQty);
                if (take.gt(0)) {
                  await tx.batch.update({ where: { id: b.id }, data: { remainingQty: new D(b.remainingQty).sub(take), initialQty: new D(b.initialQty ?? 0).sub(take) } });
                  left = left.sub(take);
                }
              }
              if (left.gt(0)) throw new ApiError(409, `« ${name} » : une partie de cet arrivage a déjà été vendue, on ne peut pas descendre plus bas`, "ALREADY_SOLD");
            }
            await tx.stockMovement.create({
              data: {
                stockId,
                type: "CORRECTION",
                quantity: delta,
                unitId: pById.get(productId)?.baseUnitId ?? null,
                referenceType: "GoodsReceipt",
                referenceId: id,
                notes: "Arrivage modifié",
                performedById: user.id,
                centerId: receipt.centerId,
              },
            });
            const unit = pById.get(productId)?.baseUnit.symbol ?? "";
            changes.push(`${name} : ${Number(before)} → ${Number(after)} ${unit}`.trim());
          }
          if (newBy.has(productId)) {
            for (const b of mine) await tx.batch.update({ where: { id: b.id }, data: { unitCost } });
          }
        }
      }

      // Lignes, fournisseur, date, frais : remplacés par la nouvelle saisie
      await tx.goodsReceiptLine.deleteMany({ where: { receiptId: id } });
      await tx.goodsReceipt.update({
        where: { id },
        data: {
          supplierId: data.supplierId ?? null,
          reference: data.reference ?? null,
          receivedAt: data.receivedAt,
          transportCost: data.transportCost,
          iceCost: data.iceCost,
          handlingCost: data.handlingCost,
          otherCosts: data.otherCosts,
          notes: data.notes ?? null,
          lines: {
            create: data.lines.map((l, i) => ({
              productId: l.productId,
              packageCount: l.packageCount,
              grossWeight: l.grossWeight,
              quantity: l.quantity,
              unitId: l.unitId,
              unitPrice: l.unitPrice,
              totalPrice: l.totalPrice,
              lotNumber: l.lotNumber || null,
              expiresAt: l.expiresAt ?? null,
              ...(receipt.isValidated ? { landedUnitCost: unitCosts[i] } : {}),
            })),
          },
        },
      });

      // Dette fournisseur : montant et fournisseur mis à jour
      if (receipt.isValidated) {
        const total = newLines.reduce((s, l) => s.add(l.totalPrice), new D(0)).add(fees);
        if (receipt.purchase) {
          if (data.supplierId) {
            await tx.purchase.update({ where: { id: receipt.purchase.id }, data: { supplierId: data.supplierId, totalAmount: total, reference: data.reference ?? null } });
          } else if (new D(receipt.purchase.paidAmount).isZero()) {
            await tx.goodsReceipt.update({ where: { id }, data: { purchaseId: null } });
            await tx.purchase.delete({ where: { id: receipt.purchase.id } });
          } else {
            await tx.purchase.update({ where: { id: receipt.purchase.id }, data: { totalAmount: total } });
          }
        } else if (data.supplierId && total.gt(0)) {
          const s = await tx.supplier.findUniqueOrThrow({ where: { id: data.supplierId }, select: { paymentTermDays: true } });
          const purchase = await tx.purchase.create({
            data: {
              companyId,
              centerId: receipt.centerId,
              supplierId: data.supplierId,
              reference: data.reference ?? null,
              totalAmount: total,
              dueDate: new Date(data.receivedAt.getTime() + s.paymentTermDays * 24 * 3600 * 1000),
              createdById: user.id,
            },
          });
          await tx.goodsReceipt.update({ where: { id }, data: { purchaseId: purchase.id } });
        }
      }

      await writeAuditLog(
        {
          eventType: "STOCK_ADJUSTED",
          companyId,
          centerId: receipt.centerId,
          userId: user.id,
          referenceType: "GoodsReceipt",
          referenceId: id,
          result: "SUCCESS",
          reason: "Arrivage modifié",
          oldValues: { lines: Object.fromEntries([...oldBy].map(([k, v]) => [k, v.toString()])), supplierId: receipt.supplierId },
          newValues: { lines: Object.fromEntries([...newBy].map(([k, v]) => [k, v.toString()])), supplierId: data.supplierId ?? null, via: "arrivage modifié" },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
    });

    scheduleStockAlerts(companyId);
    notifyManagers({
      companyId,
      centerId: receipt.centerId,
      actorId: user.id,
      type: "STOCK_EDITED",
      title: "Arrivage modifié",
      message: `${await actorLabel(user.id)} a modifié l'arrivage du ${receipt.receivedAt.toLocaleDateString("fr-FR")}${changes.length ? ` : ${changes.join(" ; ")}` : " (fournisseur, prix ou frais)"}.`,
      link: "/receptions",
    });
    return NextResponse.json({ success: true, data: { id, changes } });
  } catch (error) {
    return handleApiError(error, "GOODS_RECEIPTS/EDIT");
  }
}

// GET /api/goods-receipts/[id] — Un arrivage avec tout ce qu'il faut pour le modifier
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    const companyId = requireCompany(user);
    const { id } = await params;
    const receipt = await prisma.goodsReceipt.findFirst({
      where: { id, center: { companyId } },
      include: {
        lines: { include: { product: { select: { id: true, name: true, sellingPrice: true, baseUnit: { select: { symbol: true } } } } } },
        supplier: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!receipt) throw new ApiError(404, "Arrivage introuvable");
    await requireCenterAccess(user, receipt.centerId);
    return NextResponse.json({ success: true, data: receipt });
  } catch (error) {
    return handleApiError(error, "GOODS_RECEIPTS");
  }
}
