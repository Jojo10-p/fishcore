import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import { deliverySchema } from "@/lib/validations";
import { recordDelivery } from "@/lib/delivery";

// POST /api/sales/[id]/deliveries — Remettre tout ou partie de la marchandise d'une facture
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:deliver");
    const companyId = requireCompany(user);
    const { id } = await params;
    const data = parseBody(deliverySchema, await readJson(req));

    const sale = await prisma.sale.findFirst({ where: { id, companyId }, select: { centerId: true } });
    if (!sale) throw new ApiError(404, "Facture introuvable");
    // La marchandise sort du magasin du centre qui a vendu
    await requireCenterAccess(user, sale.centerId);

    const result = await prisma.$transaction(async (tx) => {
      const r = await recordDelivery(tx, { companyId, saleId: id, userId: user.id, request: data.lines, notes: data.notes });
      await writeAuditLog(
        {
          eventType: "GOODS_DELIVERED",
          companyId,
          centerId: r.sale.centerId,
          userId: user.id,
          referenceType: "Sale",
          referenceId: id,
          result: "SUCCESS",
          newValues: { saleNumber: r.sale.saleNumber, delivery: r.delivery.number, lines: data.lines, status: r.deliveryStatus },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return r;
    });

    return NextResponse.json(
      { success: true, data: { ...result.delivery, deliveryStatus: result.deliveryStatus } },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, "DELIVERY");
  }
}
