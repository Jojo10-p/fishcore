import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { transferReceiveSchema } from "@/lib/validations";
import { applyStockChange } from "@/lib/stock-ops";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCenterAccess, requireCompany, requirePermission } from "@/lib/auth";
import { batchesOf, loadTransferFor } from "@/lib/transfers";
import { scheduleStockAlerts } from "@/lib/stock-alerts";

const D = Prisma.Decimal;
type Ctx = { params: Promise<{ id: string }> };

// POST /api/transfers/[id]/receive — Réception à destination (quantités réellement
// reçues ; un manquant est tracé comme écart de transfert).
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:transfer");
    const companyId = requireCompany(user);
    const { id } = await params;
    const body = parseBody(transferReceiveSchema, await readJson(req));
    const transfer = await loadTransferFor(user, id, companyId);
    await requireCenterAccess(user, transfer.toCenterId);

    const result = await prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "stock_transfers" WHERE "id" = ${id} FOR UPDATE`;
        if (locked?.status !== "IN_TRANSIT") throw new ApiError(409, "Ce transfert n'est plus en transit", "TRANSFER_CLOSED");

        const lines = await tx.stockTransferLine.findMany({
          where: { transferId: id },
          include: { product: { select: { id: true, name: true, baseUnitId: true, trackBatches: true, baseUnit: { select: { allowsDecimal: true } } } } },
        });
        for (const r of body.lines ?? []) {
          if (!lines.some((l) => l.id === r.lineId)) throw new ApiError(400, "Ligne inconnue dans la réception");
        }

        let receivedValue = new D(0);
        let missingValue = new D(0);
        const gaps: Array<{ productId: string; missing: string }> = [];
        for (const line of lines) {
          const asked = body.lines?.find((r) => r.lineId === line.id);
          const received = asked ? new D(asked.receivedQty) : new D(line.quantity);
          if (received.gt(line.quantity)) throw new ApiError(400, `« ${line.product.name} » : reçu plus que l'expédié`, "OVER_RECEIVED");
          if (!line.product.baseUnit.allowsDecimal && !received.isInteger()) {
            throw new ApiError(400, `« ${line.product.name} » se compte en nombre entier`, "INTEGER_QUANTITY");
          }
          if (received.gt(0)) {
            await applyStockChange(tx, {
              centerId: transfer.toCenterId,
              productId: line.productId,
              productName: line.product.name,
              unitId: line.product.baseUnitId,
              trackBatches: line.product.trackBatches,
              delta: received,
              type: "TRANSFER_IN",
              referenceType: "StockTransfer",
              referenceId: id,
              notes: `Transfert ${transfer.number} depuis ${transfer.fromCenter.name}`,
              userId: user.id,
              incomingUnitCost: new D(line.unitCost),
              incomingBatches: batchesOf(line.batches),
              newLotNumber: transfer.number,
            });
          }
          await tx.stockTransferLine.update({ where: { id: line.id }, data: { receivedQty: received } });
          receivedValue = receivedValue.add(received.mul(line.unitCost));
          const missing = new D(line.quantity).sub(received);
          if (missing.gt(0)) {
            missingValue = missingValue.add(missing.mul(line.unitCost));
            gaps.push({ productId: line.productId, missing: missing.toString() });
          }
        }

        const done = await tx.stockTransfer.update({
          where: { id },
          data: { status: "RECEIVED", receivedAt: new Date(), receivedById: user.id, receptionNotes: body.notes || null },
        });
        await writeAuditLog(
          {
            eventType: "STOCK_TRANSFER_RECEIVED",
            companyId,
            centerId: transfer.toCenterId,
            userId: user.id,
            referenceType: "StockTransfer",
            referenceId: id,
            result: "SUCCESS",
            reason: body.notes,
            newValues: {
              number: transfer.number,
              receivedValue: receivedValue.toDecimalPlaces(0).toString(),
              missingValue: missingValue.toDecimalPlaces(0).toString(),
              gaps,
            },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
        return { transfer: done, missingValue: missingValue.toDecimalPlaces(0).toString(), gaps };
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
    scheduleStockAlerts(companyId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, "TRANSFERS");
  }
}
