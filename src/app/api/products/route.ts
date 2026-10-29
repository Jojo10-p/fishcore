import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validations";
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

const PRODUCT_TYPES = ["FRESH", "FROZEN", "SMOKED", "DRIED", "OTHER"] as const;
type ProductTypeValue = (typeof PRODUCT_TYPES)[number];

// GET /api/products — Catalogue de l'entreprise (avec le stock d'un centre si centerId)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:view");
    const companyId = requireCompany(user);

    const { searchParams } = new URL(req.url);
    const centerId = searchParams.get("centerId");
    const search = searchParams.get("search") ?? "";
    const typeParam = searchParams.get("type");
    const type = PRODUCT_TYPES.includes(typeParam as ProductTypeValue) ? (typeParam as ProductTypeValue) : undefined;
    const activeOnly = searchParams.get("active") !== "false";

    if (centerId) await requireCenterAccess(user, centerId);

    const products = await prisma.product.findMany({
      where: {
        companyId,
        isActive: activeOnly ? true : undefined,
        ...(type ? { type } : {}),
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
        ...(centerId
          ? { stocks: { where: { centerId }, select: { quantity: true, reservedQty: true, version: true } } }
          : {}),
      },
      orderBy: { name: "asc" },
    });

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

    return NextResponse.json({ success: true, data: products, offlineData });
  } catch (error) {
    return handleApiError(error, "PRODUCTS");
  }
}

// POST /api/products — Créer un produit
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:create");
    const companyId = requireCompany(user);
    const data = parseBody(productSchema, await readJson(req));

    // L'unité doit être une unité de l'entreprise ou une unité globale
    const unit = await prisma.unit.findFirst({
      where: { id: data.baseUnitId, OR: [{ companyId }, { companyId: null }] },
      select: { id: true },
    });
    if (!unit) throw new ApiError(400, "Unité de mesure invalide");

    const product = await prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: { companyId, ...data },
        include: { baseUnit: true },
      });

      // Prix initial dans l'historique (sert de référence aux ventes hors connexion)
      await tx.productPriceHistory.create({
        data: {
          productId: newProduct.id,
          purchasePrice: data.purchasePrice ?? 0,
          sellingPrice: data.sellingPrice ?? 0,
          changedById: user.id,
        },
      });

      await writeAuditLog(
        {
          eventType: "PRICE_CHANGED",
          companyId,
          userId: user.id,
          referenceType: "Product",
          referenceId: newProduct.id,
          result: "SUCCESS",
          reason: "Création du produit",
          newValues: { name: newProduct.name, sellingPrice: data.sellingPrice, purchasePrice: data.purchasePrice },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );

      return newProduct;
    });

    return NextResponse.json({ success: true, data: product }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "PRODUCTS");
  }
}
