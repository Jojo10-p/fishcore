import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  handleApiError,
  requireCompany,
  requirePermission,
  resolveCenterScope,
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

// GET /api/cancellations?status=PENDING&centerId=… — Demandes d'annulation à traiter
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:view");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const centerScope = await resolveCenterScope(user, sp.get("centerId"));
    const statusParam = sp.get("status");
    const status = STATUSES.find((s) => s === statusParam);

    const cancellations = await prisma.cancellation.findMany({
      where: {
        ...(status ? { status } : {}),
        sale: { companyId, ...(centerScope ? { centerId: centerScope } : {}) },
        // Sans droit d'approbation, on ne voit que ses propres demandes
        ...(hasPermission(user.role, "sale:cancel_approve") ? {} : { requesterId: user.id }),
      },
      include: {
        sale: { select: { id: true, saleNumber: true, totalAmount: true, createdAt: true, centerId: true, sessionId: true } },
        requester: { select: { id: true, firstName: true, lastName: true } },
        approver: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ success: true, data: cancellations });
  } catch (error) {
    return handleApiError(error, "CANCELLATIONS");
  }
}
