import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCompany } from "@/lib/auth";

// GET /api/price-decisions — Prix de vente à choisir après un arrivage moins cher (direction)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (user.role !== "COMPANY_OWNER") throw new ApiError(403, "Réservé à la direction");
    const companyId = requireCompany(user);
    const rows = await prisma.priceDecision.findMany({ where: { companyId, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true } });
    return NextResponse.json({ success: true, data: rows.map((r) => r.id) });
  } catch (error) {
    return handleApiError(error, "PRICE_DECISIONS");
  }
}
