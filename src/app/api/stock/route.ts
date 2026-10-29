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
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import type { Permission } from "@/lib/rbac";

const D = Prisma.Decimal;

// GET /api/stock?centerId=xxx — Stock d'un centre (avec données produits)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");

    const { searchParams } = new URL(req.url);
    const centerId = searchParams.get("centerId");
    const lowStock = searchParams.get("lowStock") === "true";
    if (!centerId) throw new ApiError(400, "centerId requis");
    await requireCenterAccess(user, centerId);

    const stocks = await prisma.stock.findMany({
      where: { centerId, ...(lowStock ? { product: { isActive: true } } : {}) },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            internalCode: true,
            barcode: true,
            species: true,
            type: true,
            sellingPrice: true,
            purchasePrice: true,
            stockAlertQty: true,
            isActive: true,
            baseUnit: { select: { id: true, name: true, symbol: true } },
          },
        },
      },
      orderBy: { product: { name: "asc" } },
    });

    const filtered = lowStock
      ? stocks.filter((s) => s.quantity.lte(s.product.stockAlertQty) && s.product.isActive)
      : stocks;

    // Format pour le client offline (IndexedDB)
    const formattedForOffline = filtered.map((s) => ({
      id: `${s.centerId}_${s.productId}`,
      centerId: s.centerId,
      productId: s.productId,
      quantity: Number(s.quantity),
      reservedQty: Number(s.reservedQty),
      version: s.version,
      productName: s.product.name,
      sellingPrice: Number(s.product.sellingPrice),
      baseUnitSymbol: s.product.baseUnit.symbol,
    }));

    return NextResponse.json({ success: true, data: filtered, offlineData: formattedForOffline });
  } catch (error) {
    return handleApiError(error, "STOCK");
  }
}

// Types de mouvement manuels et permission requise pour chacun.
// (RECEPTION et SALE passent obligatoirement par leurs modules respectifs.)
const MANUAL_TYPES = {
  INVENTORY_ADJUST: { permission: "stock:adjust", sign: "signed", event: "STOCK_ADJUSTED" },
  CORRECTION: { permission: "stock:adjust", sign: "signed", event: "STOCK_ADJUSTED" },
  LOSS: { permission: "stock:loss", sign: "out", event: "STOCK_LOSS_RECORDED" },
  DETERIORATION: { permission: "stock:loss", sign: "out", event: "STOCK_LOSS_RECORDED" },
  TRANSFER_OUT: { permission: "stock:transfer", sign: "out", event: "STOCK_TRANSFERRED" },
  TRANSFER_IN: { permission: "stock:transfer", sign: "in", event: "STOCK_TRANSFERRED" },
} as const satisfies Record<
  string,
  { permission: Permission; sign: "in" | "out" | "signed"; event: "STOCK_ADJUSTED" | "STOCK_LOSS_RECORDED" | "STOCK_TRANSFERRED" }
>;

const adjustmentSchema = z.object({
  centerId: z.string().min(1),
  productId: z.string().min(1),
  type: z.enum(Object.keys(MANUAL_TYPES) as [keyof typeof MANUAL_TYPES, ...(keyof typeof MANUAL_TYPES)[]]),
  quantity: z.coerce.number().refine((n) => n !== 0, "Quantité invalide"),
  reason: z.string().trim().min(3, "Motif obligatoire (min. 3 caractères)"),
});

// POST /api/stock — Mouvement de stock manuel (toujours justifié et historisé, cahier §8.4)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const companyId = requireCompany(user);
    const { centerId, productId, type, quantity, reason } = parseBody(adjustmentSchema, await readJson(req));

    const rule = MANUAL_TYPES[type];
    await requirePermission(user, rule.permission);
    await requireCenterAccess(user, centerId);

    const product = await prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, name: true, baseUnitId: true },
    });
    if (!product) throw new ApiError(404, "Produit introuvable");

    // Quantité signée : sorties toujours négatives, entrées toujours positives
    const abs = new D(quantity).abs();
    const delta = rule.sign === "out" ? abs.negated() : rule.sign === "in" ? abs : new D(quantity);

    const result = await prisma.$transaction(async (tx) => {
      // S'assure que la ligne de stock existe (quantité 0 si nouvelle)
      await tx.stock.upsert({
        where: { centerId_productId: { centerId, productId } },
        create: { centerId, productId, quantity: 0 },
        update: {},
      });

      // Application conditionnelle : le stock ne peut jamais devenir négatif
      const rows = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal }[]>`
        UPDATE "stocks"
           SET "quantity" = "quantity" + ${delta.toString()}::numeric,
               "version" = "version" + 1,
               "updatedAt" = NOW()
         WHERE "centerId" = ${centerId}
           AND "productId" = ${productId}
           AND "quantity" + ${delta.toString()}::numeric >= "reservedQty"
     RETURNING "id", "quantity"`;
      if (rows.length === 0) {
        throw new ApiError(409, `Stock insuffisant pour « ${product.name} »`, "INSUFFICIENT_STOCK");
      }
      const stock = rows[0];

      const movement = await tx.stockMovement.create({
        data: {
          stockId: stock.id,
          type,
          quantity: delta,
          unitId: product.baseUnitId,
          referenceType: "Manual",
          notes: reason,
          performedById: user.id,
          centerId,
        },
      });

      await writeAuditLog(
        {
          eventType: rule.event,
          companyId,
          centerId,
          userId: user.id,
          referenceType: "StockMovement",
          referenceId: movement.id,
          result: "SUCCESS",
          reason,
          oldValues: { quantity: new D(stock.quantity).sub(delta).toString() },
          newValues: { quantity: new D(stock.quantity).toString(), delta: delta.toString(), type, productId },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );

      return { stock, movement };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, "STOCK");
  }
}
