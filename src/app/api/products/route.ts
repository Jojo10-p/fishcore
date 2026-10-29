import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validations";

// GET /api/products — Catalogue produits pour un centre (ou toute l'entreprise)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");
    const centerId = searchParams.get("centerId");
    const search = searchParams.get("search") ?? "";
    const type = searchParams.get("type");
    const activeOnly = searchParams.get("active") !== "false";

    // Si centerId fourni, on remonte le companyId depuis le centre
    let resolvedCompanyId = companyId;
    if (!resolvedCompanyId && centerId) {
      const center = await prisma.center.findUnique({
        where: { id: centerId },
        select: { companyId: true },
      });
      resolvedCompanyId = center?.companyId ?? null;
    }

    if (!resolvedCompanyId) {
      return NextResponse.json(
        { success: false, error: "companyId ou centerId requis" },
        { status: 400 }
      );
    }

    const products = await prisma.product.findMany({
      where: {
        companyId: resolvedCompanyId,
        isActive: activeOnly ? true : undefined,
        ...(type ? { type: type as "FRESH" | "FROZEN" | "SMOKED" | "DRIED" | "OTHER" } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { internalCode: { contains: search, mode: "insensitive" } },
                { barcode: { contains: search, mode: "insensitive" } },
                { species: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        baseUnit: { select: { id: true, name: true, symbol: true } },
        // Stock du centre si centerId fourni
        ...(centerId
          ? {
              stocks: {
                where: { centerId },
                select: { quantity: true, reservedQty: true, version: true },
              },
            }
          : {}),
      },
      orderBy: { name: "asc" },
    });

    // Format optimisé pour l'offline (IndexedDB)
    const offlineData = products.map((p) => ({
      id: p.id,
      name: p.name,
      internalCode: p.internalCode,
      barcode: p.barcode,
      species: p.species,
      type: p.type,
      sellingPrice: Number(p.sellingPrice),
      purchasePrice: Number(p.purchasePrice),
      baseUnitId: p.baseUnitId,
      baseUnitSymbol: p.baseUnit.symbol,
      stockAlertQty: Number(p.stockAlertQty),
      isActive: p.isActive,
    }));

    return NextResponse.json({
      success: true,
      data: products,
      offlineData,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Erreur serveur" },
      { status: 500 }
    );
  }
}

// POST /api/products — Créer un produit
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = productSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { companyId } = body;
    if (!companyId) {
      return NextResponse.json(
        { success: false, error: "companyId requis" },
        { status: 400 }
      );
    }

    const product = await prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          companyId,
          ...parsed.data,
        },
        include: { baseUnit: true },
      });

      // Enregistrer le prix initial dans l'historique
      if (parsed.data.sellingPrice || parsed.data.purchasePrice) {
        await tx.productPriceHistory.create({
          data: {
            productId: newProduct.id,
            purchasePrice: parsed.data.purchasePrice ?? 0,
            sellingPrice: parsed.data.sellingPrice ?? 0,
            changedById: body.createdById ?? "system",
          },
        });
      }

      return newProduct;
    });

    return NextResponse.json({ success: true, data: product }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
