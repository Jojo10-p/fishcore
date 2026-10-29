import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  isUniqueViolation,
  parseBody,
  readJson,
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import { attributesSchema, packagingSchema } from "@/lib/validations";
import { assertBarcodeFree, productClientSelect, replacePackagings } from "@/lib/catalog";

const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    internalCode: z.string().trim().optional(),
    barcode: z.string().trim().optional(),
    brand: z.string().trim().optional(),
    categoryId: z.string().nullable().optional(),
    description: z.string().optional(),
    attributes: attributesSchema.optional(),
    purchasePrice: z.coerce.number().min(0).optional(),
    sellingPrice: z.coerce.number().min(0).optional(),
    stockAlertQty: z.coerce.number().min(0).optional(),
    taxRate: z.coerce.number().min(0).max(100).optional(),
    trackBatches: z.boolean().optional(),
    requiresExpiry: z.boolean().optional(),
    requiresPrescription: z.boolean().optional(),
    isActive: z.boolean().optional(),
    packagings: z.array(packagingSchema).max(10).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "Aucune modification");

// PATCH /api/products/[id] — Modifier un produit.
// Tout changement de prix est historisé (ProductPriceHistory) et journalisé (PRICE_CHANGED).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:edit");
    const companyId = requireCompany(user);
    const { id } = await params;
    const { packagings, attributes, ...data } = parseBody(updateSchema, await readJson(req));

    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findFirst({ where: { id, companyId } });
      if (!current) throw new ApiError(404, "Produit introuvable");

      if (data.categoryId) {
        const cat = await tx.category.findFirst({ where: { id: data.categoryId, companyId }, select: { id: true } });
        if (!cat) throw new ApiError(400, "Catégorie invalide");
      }
      if (data.barcode && data.barcode !== current.barcode) await assertBarcodeFree(tx, companyId, data.barcode, id);

      // Désactiver le suivi par lot alors que des lots ont encore du stock fausserait la traçabilité
      const trackBatches = data.requiresExpiry ? true : data.trackBatches;
      if (trackBatches === false && current.trackBatches) {
        const open = await tx.batch.count({ where: { productId: id, remainingQty: { gt: 0 } } });
        if (open > 0) throw new ApiError(409, "Des lots de ce produit sont encore en stock : suivi par lot impossible à désactiver", "BATCHES_IN_STOCK");
      }

      const updated = await tx.product.update({
        where: { id },
        data: {
          ...data,
          ...(trackBatches !== undefined ? { trackBatches } : {}),
          ...(data.barcode !== undefined ? { barcode: data.barcode || null } : {}),
          ...(data.internalCode !== undefined ? { internalCode: data.internalCode || null } : {}),
          ...(attributes !== undefined ? { attributes } : {}),
        },
      });

      if (packagings) {
        await replacePackagings(tx, { companyId, productId: id, baseUnitId: current.baseUnitId, packagings, productBarcode: updated.barcode });
      }

      const priceChanged =
        (data.sellingPrice !== undefined && !new Prisma.Decimal(data.sellingPrice).equals(current.sellingPrice)) ||
        (data.purchasePrice !== undefined && !new Prisma.Decimal(data.purchasePrice).equals(current.purchasePrice));

      if (priceChanged) {
        await tx.productPriceHistory.create({
          data: { productId: id, purchasePrice: updated.purchasePrice, sellingPrice: updated.sellingPrice, changedById: user.id },
        });
        await writeAuditLog(
          {
            eventType: "PRICE_CHANGED",
            companyId,
            userId: user.id,
            referenceType: "Product",
            referenceId: id,
            result: "SUCCESS",
            oldValues: { sellingPrice: current.sellingPrice.toString(), purchasePrice: current.purchasePrice.toString() },
            newValues: { sellingPrice: updated.sellingPrice.toString(), purchasePrice: updated.purchasePrice.toString() },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
      }
      return tx.product.findUniqueOrThrow({ where: { id }, select: productClientSelect });
    });

    return NextResponse.json({ success: true, data: product });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: false, error: "Ce code-barres est déjà utilisé", code: "BARCODE_TAKEN" }, { status: 409 });
    }
    return handleApiError(error, "PRODUCTS");
  }
}
