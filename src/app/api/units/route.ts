import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";

// GET /api/units — Unités de mesure de l'entreprise (+ unités globales)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:view");
    const companyId = requireCompany(user);
    const units = await prisma.unit.findMany({
      where: { OR: [{ companyId }, { companyId: null }] },
      select: { id: true, name: true, symbol: true, isBaseUnit: true },
      orderBy: [{ isBaseUnit: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ success: true, data: units });
  } catch (error) {
    return handleApiError(error, "UNITS");
  }
}
