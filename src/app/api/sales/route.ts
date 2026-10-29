import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSaleSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";
import { generateSaleNumber } from "@/lib/utils";

// POST /api/sales — Créer une vente (avec idempotence)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createSaleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Vérification auth via cookie
    const sessionToken = req.cookies.get("fishcore-session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ success: false, error: "Non authentifié" }, { status: 401 });
    }

    // TODO: valider le token et récupérer l'utilisateur (à brancher sur auth/session.ts)
    // Pour l'instant, on utilise cashierId depuis la session de caisse
    const cashSession = await prisma.cashSession.findUnique({
      where: { id: data.sessionId },
      select: { cashierId: true, cashRegister: { select: { centerId: true } } },
    });
    if (!cashSession) {
      return NextResponse.json({ success: false, error: "Session de caisse introuvable" }, { status: 404 });
    }

    const cashierId = cashSession.cashierId;
    const centerId = cashSession.cashRegister.centerId;

    // Vérifier l'idempotence — si la vente existe déjà, la retourner
    const existing = await prisma.sale.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
      include: { lines: true, payments: true },
    });
    if (existing) {
      return NextResponse.json({ success: true, data: existing });
    }

    // Exécuter dans une transaction
    const sale = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      let discountAmount = 0;

      // Vérifier et décrémenter les stocks
      for (const line of data.lines) {
        const stock = await tx.stock.findUnique({
          where: { centerId_productId: { centerId, productId: line.productId } },
        });

        if (!stock) {
          throw new Error(`Stock introuvable pour le produit ${line.productId}`);
        }

        const available = Number(stock.quantity) - Number(stock.reservedQty);
        if (available < line.quantity) {
          const product = await tx.product.findUnique({
            where: { id: line.productId },
            select: { name: true },
          });
          throw new Error(
            `Stock insuffisant pour "${product?.name ?? line.productId}" : disponible ${available}`
          );
        }

        // Verrou optimiste
        const updated = await tx.stock.updateMany({
          where: {
            centerId_productId: { centerId, productId: line.productId },
            version: stock.version,
          },
          data: {
            quantity: { decrement: line.quantity },
            version: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          throw new Error(`Conflit de stock détecté pour le produit ${line.productId}. Réessayez.`);
        }

        // Mouvement de stock
        await tx.stockMovement.create({
          data: {
            stockId: stock.id,
            type: "SALE",
            quantity: -line.quantity,
            unitId: line.unitId,
            referenceType: "Sale",
            referenceId: "pending", // mis à jour après
            performedById: cashierId,
            centerId,
          },
        });

        const lineTotal = line.quantity * line.unitPrice - (line.discount ?? 0) * line.quantity;
        subtotal += lineTotal + (line.discount ?? 0) * line.quantity;
        discountAmount += (line.discount ?? 0) * line.quantity;
      }

      const totalAmount = subtotal - discountAmount;

      // Récupérer les infos de l'entreprise pour le numéro de vente
      const center = await tx.center.findUnique({
        where: { id: centerId },
        select: { companyId: true, company: { select: { invoicePrefix: true, invoiceCounter: true } } },
      });
      if (!center) throw new Error("Centre introuvable");

      // Incrémenter le compteur de factures
      await tx.company.update({
        where: { id: center.companyId },
        data: { invoiceCounter: { increment: 1 } },
      });

      const saleNumber = generateSaleNumber(
        center.company.invoicePrefix,
        center.company.invoiceCounter
      );

      // Créer la vente
      const newSale = await tx.sale.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          companyId: center.companyId,
          centerId,
          sessionId: data.sessionId,
          cashierId,
          customerId: data.customerId,
          saleNumber,
          subtotal,
          discountAmount,
          totalAmount,
          notes: data.notes,
          createdOffline: data.createdOffline ?? false,
          deviceId: data.deviceId,
          syncedAt: data.createdOffline ? null : new Date(),
          lines: {
            create: data.lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitId: l.unitId,
              unitPrice: l.unitPrice,
              discount: l.discount ?? 0,
              lineTotal: l.quantity * l.unitPrice - (l.discount ?? 0) * l.quantity,
            })),
          },
          payments: {
            create: data.payments.map((p) => ({
              idempotencyKey: `${data.idempotencyKey}_${p.method}`,
              method: p.method,
              amount: p.amount,
              reference: p.reference,
            })),
          },
        },
        include: { lines: true, payments: true },
      });

      return newSale;
    });

    // Audit log (hors transaction pour ne pas bloquer)
    await writeAuditLog({
      eventType: "SALE_CREATED",
      companyId: sale.companyId,
      centerId,
      userId: cashierId,
      referenceType: "Sale",
      referenceId: sale.id,
      result: "SUCCESS",
      newValues: { saleNumber: sale.saleNumber, total: sale.totalAmount },
    });

    return NextResponse.json({ success: true, data: sale }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET /api/sales — Lister les ventes
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const centerId = searchParams.get("centerId");
    const sessionId = searchParams.get("sessionId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const page = parseInt(searchParams.get("page") ?? "1");
    const limit = parseInt(searchParams.get("limit") ?? "50");

    const where = {
      ...(centerId && { centerId }),
      ...(sessionId && { sessionId }),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom && { gte: new Date(dateFrom) }),
              ...(dateTo && { lte: new Date(dateTo) }),
            },
          }
        : {}),
    };

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          lines: { include: { product: { select: { name: true } } } },
          payments: true,
          cashier: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sale.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: sales,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Erreur serveur" },
      { status: 500 }
    );
  }
}
