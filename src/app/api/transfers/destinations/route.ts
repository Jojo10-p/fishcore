import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";

// GET /api/transfers/destinations — Centres actifs de l'entreprise (destination
// possible d'un transfert, même sans y être affecté)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:transfer");
    const companyId = requireCompany(user);
    const centers = await prisma.center.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ success: true, data: centers });
  } catch (error) {
    return handleApiError(error, "TRANSFERS");
  }
}
