import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

// POST /api/goods-receipts/[id]/validate — Valider une réception de marchandises
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { validatedById } = body;

    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id },
      include: {
        lines: true,
        center: { select: { companyId: true } },
      },
    });

    if (!receipt) {
      return NextResponse.json({ success: false, error: "Réception introuvable" }, { status: 404 });
    }
    if (receipt.isValidated) {
      return NextResponse.json({ success: false, error: "Réception déjà validée" }, { status: 409 });
    }

    // Transaction : mise à jour stock + validation réception
    await prisma.$transaction(async (tx) => {
      for (const line of receipt.lines) {
        // Upsert stock (crée s'il n'existe pas)
        const stock = await tx.stock.upsert({
          where: {
            centerId_productId: {
              centerId: receipt.centerId,
              productId: line.productId,
            },
          },
          create: {
            centerId: receipt.centerId,
            productId: line.productId,
            quantity: Number(line.netWeight),
          },
          update: {
            quantity: { increment: Number(line.netWeight) },
            version: { increment: 1 },
          },
        });

        // Créer un lot (batch)
        const batch = await tx.batch.create({
          data: {
            receiptId: id,
            cartonCount: line.cartonCount,
            grossWeight: line.grossWeight,
            netWeight: line.netWeight,
            receivedAt: receipt.receivedAt,
          },
        });

        // Mouvement de stock
        await tx.stockMovement.create({
          data: {
            stockId: stock.id,
            type: "RECEPTION",
            quantity: Number(line.netWeight),
            unitId: line.unitId ?? undefined,
            batchId: batch.id,
            referenceType: "GoodsReceipt",
            referenceId: id,
            performedById: validatedById ?? "system",
            centerId: receipt.centerId,
          },
        });
      }

      // Valider la réception
      await tx.goodsReceipt.update({
        where: { id },
        data: {
          isValidated: true,
          isDraft: false,
          validatedAt: new Date(),
          validatedById: validatedById ?? "system",
        },
      });
    });

    await writeAuditLog({
      eventType: "STOCK_RECEIVED",
      companyId: receipt.center.companyId,
      centerId: receipt.centerId,
      userId: validatedById,
      referenceType: "GoodsReceipt",
      referenceId: id,
      result: "SUCCESS",
      newValues: { linesCount: receipt.lines.length },
    });

    return NextResponse.json({
      success: true,
      message: "Réception validée. Stock mis à jour.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
