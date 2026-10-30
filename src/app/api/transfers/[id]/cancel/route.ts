import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { cancelReasonSchema } from "@/lib/validations";
import { applyStockChange } from "@/lib/stock-ops";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCenterAccess, requireCompany, requirePermission } from "@/lib/auth";
import { batchesOf, loadTransferFor } from "@/lib/transfers";

const D = Prisma.Decimal;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/transfers/[id]/cancel — Annulation avant réception : la marchandise
// revient au centre d'origine (mêmes lots, même coût).
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:transfer");
    const companyId = requireCompany(user);
    const { id } = await params;
    const { reason } = parseBody(cancelReasonSchema, await readJson(req));
    const transfer = await loadTransferFor(user, id, companyId);
    await requireCenterAccess(user, transfer.fromCenterId);

    const done = await prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "stock_transfers" WHERE "id" = ${id} FOR UPDATE`;
        if (locked?.status !== "IN_TRANSIT") throw new ApiError(409, "Seul un transfert en transit peut être annulé", "TRANSFER_CLOSED");

        const lines = await tx.stockTransferLine.findMany({
          where: { transferId: id },
          include: { product: { select: { id: true, name: true, baseUnitId: true, trackBatches: true } } },
        });
        for (const line of lines) {
          await applyStockChange(tx, {
            centerId: transfer.fromCenterId,
            productId: line.productId,
            productName: line.product.name,
            unitId: line.product.baseUnitId,
            trackBatches: line.product.trackBatches,
            delta: new D(line.quantity),
            type: "TRANSFER_IN",
            referenceType: "StockTransfer",
            referenceId: id,
            notes: `Annulation du transfert ${transfer.number} : ${reason}`,
            userId: user.id,
            incomingUnitCost: new D(line.unitCost),
            incomingBatches: batchesOf(line.batches),
            newLotNumber: transfer.number,
          });
        }
        const updated = await tx.stockTransfer.update({
          where: { id },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id, receptionNotes: `Annulé : ${reason}` },
        });
        await writeAuditLog(
          {
            eventType: "STOCK_TRANSFER_CANCELLED",
            companyId,
            centerId: transfer.fromCenterId,
            userId: user.id,
            referenceType: "StockTransfer",
            referenceId: id,
            result: "SUCCESS",
            reason,
            newValues: { number: transfer.number },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
        return updated;
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
    return NextResponse.json({ success: true, data: done });
  } catch (error) {
    return handleApiError(error, "TRANSFERS");
  }
}
