import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    internalCode: z.string().trim().optional(),
    barcode: z.string().trim().optional(),
    species: z.string().trim().optional(),
    type: z.enum(["FRESH", "FROZEN", "SMOKED", "DRIED", "OTHER"]).optional(),
    description: z.string().optional(),
    purchasePrice: z.coerce.number().min(0).optional(),
    sellingPrice: z.coerce.number().min(0).optional(),
    stockAlertQty: z.coerce.number().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "Aucune modification");

// PATCH /api/products/[id] — Modifier un produit. Tout changement de prix est
// historisé (ProductPriceHistory) et journalisé (PRICE_CHANGED).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:edit");
    const companyId = requireCompany(user);
    const { id } = await params;
    const data = parseBody(updateSchema, await readJson(req));

    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findFirst({ where: { id, companyId } });
      if (!current) throw new ApiError(404, "Produit introuvable");

      const updated = await tx.product.update({ where: { id }, data });

      const priceChanged =
        (data.sellingPrice !== undefined && !new Prisma.Decimal(data.sellingPrice).equals(current.sellingPrice)) ||
        (data.purchasePrice !== undefined && !new Prisma.Decimal(data.purchasePrice).equals(current.purchasePrice));

      if (priceChanged) {
        await tx.productPriceHistory.create({
          data: {
            productId: id,
            purchasePrice: updated.purchasePrice,
            sellingPrice: updated.sellingPrice,
            changedById: user.id,
          },
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
      return updated;
    });

    return NextResponse.json({ success: true, data: product });
  } catch (error) {
    return handleApiError(error, "PRODUCTS");
  }
}
