import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCompany } from "@/lib/auth";

// GET /api/product-suggestions — liste de noms d'articles proposés à l'ajout de stock
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    requireCompany(user);
    // Suggestions de la boutique choisie (huile de moteur ou huile d'arachide) + communes
    const centerId = req.nextUrl.searchParams.get("centerId");
    const list = await prisma.productSuggestion.findMany({
      where: centerId ? { OR: [{ centerId: null }, { centerId }] } : {},
      select: { id: true, name: true, liters: true, unitsPerCarton: true, category: true },
      orderBy: { name: "asc" },
      take: 2000,
    });
    return NextResponse.json({ success: true, data: list.map((s) => ({ ...s, liters: s.liters ? Number(s.liters) : null })) });
  } catch (error) {
    return handleApiError(error, "PRODUCTS");
  }
}
