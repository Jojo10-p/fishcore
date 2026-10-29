import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

// GET /api/stock?centerId=xxx — Stock d'un centre (avec données produits)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const centerId = searchParams.get("centerId");
    const lowStock = searchParams.get("lowStock") === "true";

    if (!centerId) {
      return NextResponse.json(
        { success: false, error: "centerId requis" },
        { status: 400 }
      );
    }

    const stocks = await prisma.stock.findMany({
      where: {
        centerId,
        ...(lowStock
          ? {
              product: {
                isActive: true,
              },
            }
          : {}),
      },
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

    // Filtrer côté serveur pour les alertes de stock faible
    const filtered = lowStock
      ? stocks.filter(
          (s) => Number(s.quantity) <= Number(s.product.stockAlertQty) && s.product.isActive
        )
      : stocks;

    // Format pour le client offline (IndexedDB)
    const formattedForOffline = filtered.map((s) => ({
      id: `${s.centerId}_${s.productId}`,
      centerId: s.centerId,
      productId: s.productId,
      quantity: Number(s.quantity),
      reservedQty: Number(s.reservedQty),
      version: s.version,
      // Info produit inline (pour le catalogue offline)
      productName: s.product.name,
      sellingPrice: Number(s.product.sellingPrice),
      baseUnitSymbol: s.product.baseUnit.symbol,
    }));

    return NextResponse.json({
      success: true,
      data: filtered,
      offlineData: formattedForOffline,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Erreur serveur" },
      { status: 500 }
    );
  }
}

// POST /api/stock — Ajustement de stock
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { centerId, productId, quantity, reason, type, performedById } = body;

    if (!centerId || !productId || quantity === undefined || !type || !performedById) {
      return NextResponse.json(
        { success: false, error: "Paramètres manquants" },
        { status: 400 }
      );
    }

    const validTypes = [
      "INVENTORY_ADJUST",
      "LOSS",
      "DETERIORATION",
      "CORRECTION",
      "TRANSFER_IN",
      "TRANSFER_OUT",
    ];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: "Type de mouvement invalide" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Créer ou mettre à jour le stock
      const stock = await tx.stock.upsert({
        where: { centerId_productId: { centerId, productId } },
        create: {
          centerId,
          productId,
          quantity: type === "LOSS" || type === "TRANSFER_OUT" ? -Math.abs(quantity) : Math.abs(quantity),
        },
        update: {
          quantity: {
            increment:
              type === "LOSS" || type === "TRANSFER_OUT" || type === "DETERIORATION"
                ? -Math.abs(quantity)
                : Math.abs(quantity),
          },
          version: { increment: 1 },
        },
      });

      // Créer le mouvement
      const movement = await tx.stockMovement.create({
        data: {
          stockId: stock.id,
          type,
          quantity:
            type === "LOSS" || type === "TRANSFER_OUT" || type === "DETERIORATION"
              ? -Math.abs(quantity)
              : Math.abs(quantity),
          referenceType: "Manual",
          notes: reason,
          performedById,
          centerId,
        },
      });

      return { stock, movement };
    });

    const eventMap: Record<string, "STOCK_ADJUSTED" | "STOCK_LOSS_RECORDED" | "STOCK_TRANSFERRED"> = {
      INVENTORY_ADJUST: "STOCK_ADJUSTED",
      CORRECTION: "STOCK_ADJUSTED",
      LOSS: "STOCK_LOSS_RECORDED",
      DETERIORATION: "STOCK_LOSS_RECORDED",
      TRANSFER_IN: "STOCK_TRANSFERRED",
      TRANSFER_OUT: "STOCK_TRANSFERRED",
    };

    await writeAuditLog({
      eventType: eventMap[type] ?? "STOCK_ADJUSTED",
      centerId,
      userId: performedById,
      referenceType: "Stock",
      referenceId: result.stock.id,
      result: "SUCCESS",
      newValues: { quantity, type, reason },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
