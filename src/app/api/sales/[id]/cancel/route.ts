import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

// POST /api/sales/[id]/cancel — Demander ou approuver une annulation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: saleId } = await params;
    const body = await req.json();
    const { action, requesterId, reason, approverId, decision, rejectionReason } = body;

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { lines: true, payments: true },
    });

    if (!sale) {
      return NextResponse.json({ success: false, error: "Vente introuvable" }, { status: 404 });
    }

    // Demande d'annulation par le caissier
    if (action === "request") {
      if (!reason || reason.length < 5) {
        return NextResponse.json({ success: false, error: "Motif requis (min. 5 caractères)" }, { status: 400 });
      }

      // Vérifier qu'il n'y a pas déjà une demande en attente
      const existing = await prisma.cancellation.findFirst({
        where: { saleId, status: "PENDING" },
      });
      if (existing) {
        return NextResponse.json(
          { success: false, error: "Une demande d'annulation est déjà en attente pour cette vente" },
          { status: 409 }
        );
      }

      const cancellation = await prisma.cancellation.create({
        data: { saleId, requesterId, requestReason: reason, status: "PENDING" },
      });

      await writeAuditLog({
        eventType: "CANCELLATION_REQUESTED",
        companyId: sale.companyId,
        centerId: sale.centerId,
        userId: requesterId,
        referenceType: "Sale",
        referenceId: saleId,
        result: "SUCCESS",
        newValues: { reason },
      });

      return NextResponse.json({ success: true, data: cancellation });
    }

    // Décision d'annulation par un manager
    if (action === "decide") {
      const { cancellationId } = body;
      const cancellation = await prisma.cancellation.findUnique({
        where: { id: cancellationId },
      });

      if (!cancellation || cancellation.status !== "PENDING") {
        return NextResponse.json(
          { success: false, error: "Demande introuvable ou déjà traitée" },
          { status: 404 }
        );
      }

      if (decision === "APPROVED") {
        // Remettre le stock en transaction
        await prisma.$transaction(async (tx) => {
          // Remettre le stock pour chaque ligne
          for (const line of sale.lines) {
            const stock = await tx.stock.findUnique({
              where: {
                centerId_productId: {
                  centerId: sale.centerId,
                  productId: line.productId,
                },
              },
            });

            if (stock) {
              await tx.stock.update({
                where: { id: stock.id },
                data: {
                  quantity: { increment: Number(line.quantity) },
                  version: { increment: 1 },
                },
              });

              await tx.stockMovement.create({
                data: {
                  stockId: stock.id,
                  type: "CUSTOMER_RETURN",
                  quantity: Number(line.quantity),
                  referenceType: "Sale",
                  referenceId: saleId,
                  notes: `Annulation ${cancellationId}`,
                  performedById: approverId ?? "system",
                  centerId: sale.centerId,
                },
              });
            }
          }

          // Mettre à jour le statut de la vente
          await tx.sale.update({
            where: { id: saleId },
            data: { status: "CANCELLED" },
          });

          // Mettre à jour la demande d'annulation
          await tx.cancellation.update({
            where: { id: cancellationId },
            data: {
              status: "APPROVED",
              approverId,
              approvedAt: new Date(),
            },
          });
        });

        await writeAuditLog({
          eventType: "CANCELLATION_APPROVED",
          companyId: sale.companyId,
          centerId: sale.centerId,
          userId: approverId,
          referenceType: "Sale",
          referenceId: saleId,
          result: "SUCCESS",
        });

        return NextResponse.json({ success: true, message: "Annulation approuvée. Stock restauré." });
      }

      if (decision === "REJECTED") {
        await prisma.cancellation.update({
          where: { id: cancellationId },
          data: {
            status: "REJECTED",
            approverId,
            rejectionReason,
          },
        });

        await writeAuditLog({
          eventType: "CANCELLATION_REJECTED",
          companyId: sale.companyId,
          centerId: sale.centerId,
          userId: approverId,
          referenceType: "Sale",
          referenceId: saleId,
          result: "SUCCESS",
          newValues: { rejectionReason },
        });

        return NextResponse.json({ success: true, message: "Demande rejetée." });
      }
    }

    return NextResponse.json({ success: false, error: "Action invalide" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET /api/sales/[id]/cancel — Voir les demandes d'annulation d'une vente
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: saleId } = await params;
  const cancellations = await prisma.cancellation.findMany({
    where: { saleId },
    include: {
      requester: { select: { firstName: true, lastName: true } },
      approver: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ success: true, data: cancellations });
}
