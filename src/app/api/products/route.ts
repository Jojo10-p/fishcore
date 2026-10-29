import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  isUniqueViolation,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business-profiles";
import { assertBarcodeFree, productClientSelect, replacePackagings, toOfflineProduct } from "@/lib/catalog";

// GET /api/products — Catalogue de l'entreprise
//   ?search=…  ?categoryId=…  ?active=false  ?barcode=… (recherche exacte, conditionnements compris)
//   ?centerId=… ajoute le stock du centre
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:view");
    const companyId = requireCompany(user);

    const sp = req.nextUrl.searchParams;
    const centerId = sp.get("centerId");
    const search = sp.get("search")?.trim() ?? "";
    const categoryId = sp.get("categoryId");
    const barcode = sp.get("barcode")?.trim();
    const activeOnly = sp.get("active") !== "false";
    if (centerId) await requireCenterAccess(user, centerId);

    const where: Prisma.ProductWhereInput = {
      companyId,
      ...(activeOnly ? { isActive: true } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(barcode ? { OR: [{ barcode }, { unitConversions: { some: { barcode } } }] } : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { internalCode: { contains: search, mode: "insensitive" } },
                  { barcode: { contains: search } },
                  { brand: { contains: search, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    };

    const products = await prisma.product.findMany({
      where,
      select: {
        ...productClientSelect,
        ...(centerId ? { stocks: { where: { centerId }, select: { quantity: true, reservedQty: true } } } : {}),
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ success: true, data: products, offlineData: products.map(toOfflineProduct) });
  } catch (error) {
    return handleApiError(error, "PRODUCTS");
  }
}

// POST /api/products — Créer un produit (options par défaut = profil métier)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:create");
    const companyId = requireCompany(user);
    const { packagings, attributes, ...data } = parseBody(productSchema, await readJson(req));

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { businessType: true, vatEnabled: true, defaultTaxRate: true },
    });
    const profile = getBusinessProfile(company.businessType);

    const unit = await prisma.unit.findFirst({
      where: { id: data.baseUnitId, OR: [{ companyId }, { companyId: null }] },
      select: { id: true },
    });
    if (!unit) throw new ApiError(400, "Unité de mesure invalide");
    if (data.categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: data.categoryId, companyId }, select: { id: true } });
      if (!cat) throw new ApiError(400, "Catégorie invalide");
    }

    const trackBatches = data.trackBatches ?? profile.productDefaults.trackBatches;
    const requiresExpiry = data.requiresExpiry ?? profile.productDefaults.requiresExpiry;

    const product = await prisma.$transaction(async (tx) => {
      if (data.barcode) await assertBarcodeFree(tx, companyId, data.barcode);

      const created = await tx.product.create({
        data: {
          companyId,
          name: data.name,
          internalCode: data.internalCode || null,
          barcode: data.barcode || null,
          brand: data.brand || null,
          categoryId: data.categoryId || null,
          baseUnitId: data.baseUnitId,
          description: data.description,
          attributes: attributes ?? undefined,
          purchasePrice: data.purchasePrice,
          sellingPrice: data.sellingPrice,
          stockAlertQty: data.stockAlertQty,
          // Une date de péremption n'a de sens que si le stock est suivi par lot
          trackBatches: trackBatches || requiresExpiry,
          requiresExpiry,
          requiresPrescription: data.requiresPrescription ?? profile.productDefaults.requiresPrescription,
          taxRate: data.taxRate ?? (company.vatEnabled ? company.defaultTaxRate : 0),
        },
      });

      if (packagings?.length) {
        await replacePackagings(tx, { companyId, productId: created.id, baseUnitId: data.baseUnitId, packagings, productBarcode: data.barcode });
      }

      // Prix initial dans l'historique (sert de référence aux ventes hors connexion)
      await tx.productPriceHistory.create({
        data: { productId: created.id, purchasePrice: data.purchasePrice, sellingPrice: data.sellingPrice, changedById: user.id },
      });

      await writeAuditLog(
        {
          eventType: "PRICE_CHANGED",
          companyId,
          userId: user.id,
          referenceType: "Product",
          referenceId: created.id,
          result: "SUCCESS",
          reason: "Création du produit",
          newValues: { name: created.name, sellingPrice: data.sellingPrice, purchasePrice: data.purchasePrice },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );

      return tx.product.findUniqueOrThrow({ where: { id: created.id }, select: productClientSelect });
    });

    return NextResponse.json({ success: true, data: product }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: false, error: "Ce code-barres est déjà utilisé", code: "BARCODE_TAKEN" }, { status: 409 });
    }
    return handleApiError(error, "PRODUCTS");
  }
}
