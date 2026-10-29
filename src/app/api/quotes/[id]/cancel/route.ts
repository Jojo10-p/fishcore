import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";

const schema = z.object({ reason: z.string().trim().min(3, "Motif requis").max(300) });

// POST /api/quotes/[id]/cancel — Annuler un devis non encaissé (conservé dans l'historique)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "quote:cancel");
    const companyId = requireCompany(user);
    const { id } = await params;
    const { reason } = parseBody(schema, await readJson(req));

    await prisma.$transaction(async (tx) => {
      // Condition dans la mise à jour : un devis encaissé entre-temps n'est pas annulé
      const res = await tx.quote.updateMany({
        where: { id, companyId, status: "OPEN" },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
      });
      if (res.count === 0) {
        const q = await tx.quote.findFirst({ where: { id, companyId }, select: { status: true } });
        if (!q) throw new ApiError(404, "Devis introuvable");
        throw new ApiError(409, q.status === "CONVERTED" ? "Ce devis a déjà été encaissé" : "Ce devis est déjà annulé", "QUOTE_NOT_OPEN");
      }
      const q = await tx.quote.findUniqueOrThrow({ where: { id }, select: { number: true, centerId: true } });
      await writeAuditLog(
        {
          eventType: "QUOTE_CANCELLED",
          companyId,
          centerId: q.centerId,
          userId: user.id,
          referenceType: "Quote",
          referenceId: id,
          result: "SUCCESS",
          newValues: { number: q.number, reason },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "QUOTES");
  }
}
