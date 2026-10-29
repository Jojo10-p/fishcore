import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

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

      for (const line of receipt.lines) {
        const stock = await tx.stock.upsert({
          where: { centerId_productId: { centerId: receipt.centerId, productId: line.productId } },
          create: { centerId: receipt.centerId, productId: line.productId, quantity: line.quantity },
          update: { quantity: { increment: line.quantity }, version: { increment: 1 } },
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
            receivedAt: receipt.receivedAt,
          },
        });

        await tx.stockMovement.create({
          data: {
            stockId: stock.id,
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

    return NextResponse.json({ success: true, message: "Réception validée. Stock mis à jour." });
  } catch (error) {
    return handleApiError(error, "GOODS_RECEIPTS");
  }
}
