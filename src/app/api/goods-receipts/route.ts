import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { goodsReceiptSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit";

// POST /api/goods-receipts — Créer une réception de marchandises
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = goodsReceiptSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { createdById } = body;
    const data = parsed.data;

    const receipt = await prisma.goodsReceipt.create({
      data: {
        centerId: data.centerId,
        supplierId: data.supplierId,
        purchaseId: data.purchaseId,
        reference: data.reference,
        receivedAt: data.receivedAt,
        transportCost: data.transportCost,
        iceCost: data.iceCost,
        handlingCost: data.handlingCost,
        otherCosts: data.otherCosts,
        notes: data.notes,
        createdById: createdById ?? "unknown",
        isDraft: true,
        isValidated: false,
        lines: {
          create: data.lines.map((line) => ({
            productId: line.productId,
            cartonCount: line.cartonCount,
            grossWeight: line.grossWeight,
            netWeight: line.netWeight,
            unitId: line.unitId,
            unitPrice: line.unitPrice,
            totalPrice: line.totalPrice,
          })),
        },
      },
      include: { lines: { include: { product: { select: { name: true } } } } },
    });

    return NextResponse.json({ success: true, data: receipt }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET /api/goods-receipts — Lister les réceptions d'un centre
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const centerId = searchParams.get("centerId");
  const validated = searchParams.get("validated");

  const receipts = await prisma.goodsReceipt.findMany({
    where: {
      ...(centerId ? { centerId } : {}),
      ...(validated !== null ? { isValidated: validated === "true" } : {}),
    },
    include: {
      lines: { include: { product: { select: { name: true } } } },
      supplier: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ success: true, data: receipts });
}
