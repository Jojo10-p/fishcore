import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";
import { canActOnCenter, loadTransferFor } from "@/lib/transfers";
import { docCompanySelect } from "@/lib/documents";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/transfers/[id] — Bon de transfert détaillé
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");
    const companyId = requireCompany(user);
    const { id } = await params;
    const transfer = await loadTransferFor(user, id, companyId);

    const [lines, users, company] = await Promise.all([
      prisma.stockTransferLine.findMany({
        where: { transferId: id },
        include: {
          product: {
            select: { id: true, name: true, internalCode: true, barcode: true, trackBatches: true, baseUnit: { select: { symbol: true, allowsDecimal: true } } },
          },
        },
        orderBy: { id: "asc" },
      }),
      prisma.user.findMany({
        where: { companyId, id: { in: [transfer.createdById, transfer.receivedById, transfer.cancelledById].filter((x): x is string => !!x) } },
        select: { id: true, firstName: true, lastName: true },
      }),
      prisma.company.findUnique({ where: { id: companyId }, select: docCompanySelect }),
    ]);
    const name = (uid: string | null) => {
      const u = users.find((x) => x.id === uid);
      return u ? `${u.firstName} ${u.lastName}`.trim() : null;
    };
    return NextResponse.json({
      success: true,
      data: {
        ...transfer,
        createdBy: name(transfer.createdById),
        receivedBy: name(transfer.receivedById),
        cancelledBy: name(transfer.cancelledById),
        canReceive: transfer.status === "IN_TRANSIT" && canActOnCenter(user, transfer.toCenterId),
        canCancel: transfer.status === "IN_TRANSIT" && canActOnCenter(user, transfer.fromCenterId),
        company,
        lines,
      },
    });
  } catch (error) {
    return handleApiError(error, "TRANSFERS");
  }
}
