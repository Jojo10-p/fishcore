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
// seulement ici, que le stock augmente (cahier §8.3).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:receive");
    const companyId = requireCompany(user);
    const { id } = await params;

    const receipt = await prisma.goodsReceipt.findFirst({
      where: { id, center: { companyId } },
      include: { lines: true, center: { select: { companyId: true } } },
    });
    if (!receipt) throw new ApiError(404, "Réception introuvable");
    await requireCenterAccess(user, receipt.centerId);
    if (receipt.isValidated) throw new ApiError(409, "Réception déjà validée", "ALREADY_VALIDATED");
    if (receipt.lines.length === 0) throw new ApiError(400, "Réception sans ligne");

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
          create: { centerId: receipt.centerId, productId: line.productId, quantity: line.netWeight },
          update: { quantity: { increment: line.netWeight }, version: { increment: 1 } },
        });

        const batch = await tx.batch.create({
          data: {
            receiptId: id,
            cartonCount: line.cartonCount,
            grossWeight: line.grossWeight,
            netWeight: line.netWeight,
            receivedAt: receipt.receivedAt,
          },
        });

        await tx.stockMovement.create({
          data: {
            stockId: stock.id,
            type: "RECEPTION",
            quantity: line.netWeight,
            unitId: line.unitId ?? undefined,
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
            linesCount: receipt.lines.length,
            totalNetWeight: receipt.lines.reduce((s, l) => s + Number(l.netWeight), 0),
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
