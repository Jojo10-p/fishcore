import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { landedUnitCosts, receiveIntoStock } from "@/lib/stock";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import { scheduleStockAlerts } from "@/lib/stock-alerts";
import { actorLabel, notifyManagers } from "@/lib/notify";

// POST /api/goods-receipts/[id]/validate — Valider une réception : c'est ici, et
// seulement ici, que le stock augmente (cahier §8.3). Chaque ligne crée un lot
// (numéro, péremption, quantité restante) utilisé ensuite par les ventes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:receive");
    const companyId = requireCompany(user);
    const { id } = await params;

    const receipt = await prisma.goodsReceipt.findFirst({
      where: { id, center: { companyId } },
      include: {
        lines: { include: { product: { select: { name: true, trackBatches: true, requiresExpiry: true, baseUnitId: true } } } },
        supplier: { select: { id: true, paymentTermDays: true, name: true } },
      },
    });
    if (!receipt) throw new ApiError(404, "Réception introuvable");
    await requireCenterAccess(user, receipt.centerId);
    if (receipt.isValidated) throw new ApiError(409, "Réception déjà validée", "ALREADY_VALIDATED");
    if (receipt.lines.length === 0) throw new ApiError(400, "Réception sans ligne");

    // Péremption obligatoire (pharmacie, alimentaire…) et jamais déjà dépassée
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (const line of receipt.lines) {
      if (line.product.requiresExpiry && !line.expiresAt) {
        throw new ApiError(400, `Date de péremption obligatoire pour « ${line.product.name} »`, "EXPIRY_REQUIRED");
      }
      if (line.expiresAt && line.expiresAt < today) {
        throw new ApiError(400, `Le lot de « ${line.product.name} » est déjà périmé`, "ALREADY_EXPIRED");
      }
    }

    await prisma.$transaction(async (tx) => {
      // Validation conditionnelle : deux validations simultanées ne peuvent pas
      // doubler le stock (seule la première passe)
      const claimed = await tx.goodsReceipt.updateMany({
        where: { id, isValidated: false },
        data: { isValidated: true, isDraft: false, validatedAt: new Date(), validatedById: user.id },
      });
      if (claimed.count === 0) throw new ApiError(409, "Réception déjà validée", "ALREADY_VALIDATED");

      // Coût de revient : prix d'achat + part des frais annexes (transport, glace, manutention…)
      const fees = new Prisma.Decimal(receipt.transportCost).add(receipt.iceCost).add(receipt.handlingCost).add(receipt.otherCosts);
      const unitCosts = landedUnitCosts(receipt.lines, fees);

      for (const [index, line] of receipt.lines.entries()) {
        const unitCost = unitCosts[index];
        await tx.goodsReceiptLine.update({ where: { id: line.id }, data: { landedUnitCost: unitCost } });
        const stock = await receiveIntoStock(tx, {
          centerId: receipt.centerId,
          productId: line.productId,
          qty: new Prisma.Decimal(line.quantity),
          unitCost,
        });

        const batch = await tx.batch.create({
          data: {
            receiptId: id,
            productId: line.productId,
            centerId: receipt.centerId,
            lotNumber: line.lotNumber,
            expiresAt: line.expiresAt,
            packageCount: line.packageCount,
            grossWeight: line.grossWeight,
            initialQty: line.quantity,
            remainingQty: line.quantity,
            unitCost,
            receivedAt: receipt.receivedAt,
          },
        });

        await tx.stockMovement.create({
          data: {
            stockId: stock.stockId,
            type: "RECEPTION",
            quantity: line.quantity,
            unitId: line.unitId ?? line.product.baseUnitId,
            batchId: batch.id,
            referenceType: "GoodsReceipt",
            referenceId: id,
            performedById: user.id,
            centerId: receipt.centerId,
          },
        });
      }

      // Dette fournisseur (cahier §12) : la réception validée devient une facture à régler
      if (receipt.supplier && !receipt.purchaseId) {
        const goods = receipt.lines.reduce((sum, l) => sum.add(l.totalPrice), new Prisma.Decimal(0));
        const total = goods.add(fees);
        if (total.gt(0)) {
          const due = new Date(receipt.receivedAt.getTime() + receipt.supplier.paymentTermDays * 24 * 3600 * 1000);
          const purchase = await tx.purchase.create({
            data: {
              companyId,
              centerId: receipt.centerId,
              supplierId: receipt.supplier.id,
              reference: receipt.reference,
              totalAmount: total,
              dueDate: due,
              createdById: user.id,
            },
          });
          await tx.goodsReceipt.update({ where: { id }, data: { purchaseId: purchase.id } });
          await writeAuditLog(
            {
              eventType: "PURCHASE_RECORDED",
              companyId,
              centerId: receipt.centerId,
              userId: user.id,
              referenceType: "Purchase",
              referenceId: purchase.id,
              result: "SUCCESS",
              newValues: { supplierId: receipt.supplier.id, total: total.toString(), dueDate: due.toISOString(), receiptId: id },
              ipAddress: user.ipAddress,
              userAgent: user.userAgent,
            },
            tx
          );
        }
      }

      await writeAuditLog(
        {
          eventType: "STOCK_RECEIVED",
          companyId,
          centerId: receipt.centerId,
          userId: user.id,
          referenceType: "GoodsReceipt",
          referenceId: id,
          result: "SUCCESS",
          newValues: {
            lines: receipt.lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity.toString(),
              landedUnitCost: unitCosts[receipt.lines.indexOf(l)].toString(),
              lotNumber: l.lotNumber,
              expiresAt: l.expiresAt?.toISOString() ?? null,
            })),
          },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
    });

    scheduleStockAlerts(companyId);

    // Résumé pour la direction : qui a ajouté quoi, chez quel fournisseur, pour combien
    const total = receipt.lines.reduce((t, l) => t + Number(l.totalPrice), 0);
    const detail = receipt.lines.map((l) => `${Number(l.quantity).toLocaleString("fr-FR")} × ${l.product.name}`).join(", ");
    notifyManagers({
      companyId,
      centerId: receipt.centerId,
      actorId: user.id,
      type: "STOCK_ADDED",
      title: `Stock ajouté${receipt.supplier ? ` — ${receipt.supplier.name}` : ""}`,
      message: `${await actorLabel(user.id)} a ajouté ${detail}. Achat : ${total.toLocaleString("fr-FR")} F.`,
      link: "/receptions",
      data: {
        receiptId: receipt.id,
        supplier: receipt.supplier?.name ?? null,
        total,
        lines: receipt.lines.map((l) => ({ name: l.product.name, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), totalPrice: Number(l.totalPrice) })),
      },
    });
    return NextResponse.json({ success: true, message: "Réception validée. Stock mis à jour." });
  } catch (error) {
    return handleApiError(error, "GOODS_RECEIPTS");
  }
}
