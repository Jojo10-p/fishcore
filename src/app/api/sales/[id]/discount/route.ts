import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, requireCenterAccess, requireCompany, requirePermission } from "@/lib/auth";
import { actorLabel, notifyManagers } from "@/lib/notify";

// POST /api/sales/[id]/discount — Le gérant ou la direction valide la réduction
// accordée par un caissier (la vente, elle, est déjà passée).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:discount");
    const companyId = requireCompany(user);
    const { id } = await params;
    const sale = await prisma.sale.findFirst({
      where: { id, companyId },
      select: { id: true, centerId: true, cashierId: true, saleNumber: true, cartDiscount: true, discountStatus: true, totalAmount: true },
    });
    if (!sale) throw new ApiError(404, "Vente introuvable");
    await requireCenterAccess(user, sale.centerId);
    if (sale.discountStatus !== "PENDING") throw new ApiError(409, "Cette réduction n'est pas en attente de validation", "NOT_PENDING");

    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.sale.updateMany({
        where: { id, discountStatus: "PENDING" },
        data: { discountStatus: "VALIDATED", discountValidatedById: user.id, discountValidatedAt: new Date() },
      });
      if (claimed.count === 0) return false;
      await writeAuditLog(
        {
          eventType: "SALE_DISCOUNT_VALIDATED",
          companyId,
          centerId: sale.centerId,
          userId: user.id,
          referenceType: "Sale",
          referenceId: id,
          result: "SUCCESS",
          reason: "Réduction du caissier validée",
          newValues: { saleNumber: sale.saleNumber, cartDiscount: sale.cartDiscount.toString(), discountStatus: "VALIDATED" },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return true;
    });
    if (!done) throw new ApiError(409, "Cette réduction vient d'être validée", "NOT_PENDING");

    notifyManagers({
      companyId,
      centerId: sale.centerId,
      actorId: user.id,
      userIds: [sale.cashierId],
      type: "SALE_MADE",
      title: `Réduction validée — vente ${sale.saleNumber}`,
      message: `${await actorLabel(user.id)} a validé la réduction de ${Number(sale.cartDiscount).toLocaleString("fr-FR")} F.`,
      link: "/ventes",
      data: { saleId: id },
    });
    return NextResponse.json({ success: true, message: "Réduction validée." });
  } catch (error) {
    return handleApiError(error, "SALES/DISCOUNT");
  }
}
