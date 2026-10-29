import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSaleSchema } from "@/lib/validations";
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
  resolveCenterScope,
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { generateSaleNumber } from "@/lib/utils";
import { priceLines, settlePayments } from "@/lib/sales";


const saleInclude = { lines: true, payments: true } satisfies Prisma.SaleInclude;

// ─────────────────────────────────────────────
// POST /api/sales — Créer une vente (cahier §9)
// ─────────────────────────────────────────────
// Garanties :
// - Idempotence : la même idempotencyKey renvoie la vente existante, jamais un doublon.
// - Le PRIX vient de la base, pas du navigateur.
// - Stock vérifié ET décrémenté en une seule instruction SQL conditionnelle :
//   deux caissiers qui vendent la dernière unité → une seule vente passe.
// - Numéro de facture attribué atomiquement (pas de doublon de numéro).
// - Vente, mouvements de stock, paiements et journal d'audit : une seule transaction.
export async function POST(req: NextRequest) {
  let idempotencyKey: string | undefined;
  let companyIdForReplay: string | undefined;
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);

    const data = parseBody(createSaleSchema, await readJson(req));
    idempotencyKey = data.idempotencyKey;
    companyIdForReplay = companyId;

    // 1. Idempotence : opération déjà enregistrée → renvoyer son résultat
    const existing = await findExistingSale(data.idempotencyKey, companyId);
    if (existing) return NextResponse.json({ success: true, data: existing, replayed: true });

    // 2. Session de caisse : ouverte, appartenant à ce caissier, dans un centre accessible
    const cashSession = await prisma.cashSession.findUnique({
      where: { id: data.sessionId },
      select: {
        id: true,
        cashierId: true,
        closedAt: true,
        cashRegister: { select: { centerId: true, isActive: true, center: { select: { companyId: true } } } },
      },
    });
    if (!cashSession || cashSession.cashRegister.center.companyId !== companyId) {
      throw new ApiError(404, "Session de caisse introuvable");
    }
    if (cashSession.cashierId !== user.id) {
      throw new ApiError(403, "Cette session de caisse appartient à un autre caissier", "SESSION_NOT_OWNED");
    }
    if (cashSession.closedAt) {
      // Cas typique : vente hors ligne synchronisée après la clôture → à traiter par un gérant
      throw new ApiError(409, "La session de caisse est clôturée", "SESSION_CLOSED");
    }
    const centerId = cashSession.cashRegister.centerId;
    if (!user.centerIds.includes(centerId) && user.role !== "COMPANY_OWNER") {
      throw new ApiError(403, "Vous n'avez pas accès à ce centre", "FORBIDDEN");
    }

    // 3. Client éventuel : doit appartenir à l'entreprise
    if (data.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, companyId },
        select: { id: true },
      });
      if (!customer) throw new ApiError(400, "Client introuvable");
    }

    // 4. Remises : réservées aux rôles autorisés
    const hasDiscount = data.lines.some((l) => (l.discount ?? 0) > 0);
    if (hasDiscount) await requirePermission(user, "sale:discount");

    // 5. Calcul des lignes à partir des prix et unités EN BASE
    const pricing = await priceLines(companyId, data.lines, data.createdOffline);

    // 6. Paiements : la somme doit couvrir le total ; l'excédent n'est admis
    //    que sous forme de rendu monnaie sur les espèces.
    const payments = settlePayments(data.payments, pricing.totalAmount);

    // 7. Transaction atomique
    const sale = await prisma.$transaction(async (tx) => {
      // 7.0 Verrou sur la session : une clôture concurrente attend la fin de la
      //     vente (et inversement), donc aucune vente n'échappe à la clôture.
      const sessionStillOpen = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "cash_sessions"
         WHERE "id" = ${cashSession.id} AND "closedAt" IS NULL
         FOR UPDATE`;
      if (sessionStillOpen.length === 0) {
        throw new ApiError(409, "La session de caisse est clôturée", "SESSION_CLOSED");
      }

      // 7a. Sortie de stock conditionnelle (verrou de ligne PostgreSQL)
      const stockIds = new Map<string, string>();
      for (const [productId, qty] of pricing.baseQtyByProduct) {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "stocks"
             SET "quantity" = "quantity" - ${qty.toString()}::numeric,
                 "version" = "version" + 1,
                 "updatedAt" = NOW()
           WHERE "centerId" = ${centerId}
             AND "productId" = ${productId}
             AND "quantity" - "reservedQty" >= ${qty.toString()}::numeric
       RETURNING "id"`;
        if (rows.length === 0) {
          const name = pricing.productNames.get(productId) ?? productId;
          throw new ApiError(409, `Stock insuffisant pour « ${name} »`, "INSUFFICIENT_STOCK");
        }
        stockIds.set(productId, rows[0].id);
      }

      // 7b. Numéro de facture : incrément atomique (la ligne entreprise est verrouillée)
      const company = await tx.company.update({
        where: { id: companyId },
        data: { invoiceCounter: { increment: 1 } },
        select: { invoicePrefix: true, invoiceCounter: true },
      });
      const saleNumber = generateSaleNumber(company.invoicePrefix, company.invoiceCounter - 1);

      // 7c. Vente + lignes + paiements
      const newSale = await tx.sale.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          companyId,
          centerId,
          sessionId: cashSession.id,
          cashierId: user.id,
          customerId: data.customerId,
          saleNumber,
          subtotal: pricing.subtotal,
          discountAmount: pricing.discountAmount,
          totalAmount: pricing.totalAmount,
          notes: data.notes,
          createdOffline: data.createdOffline ?? false,
          deviceId: data.deviceId,
          syncedAt: new Date(),
          lines: { create: pricing.lines },
          payments: {
            create: payments.map((p, i) => ({
              idempotencyKey: `${data.idempotencyKey}_p${i}`,
              method: p.method,
              amount: p.amount,
              reference: p.reference,
              notes: p.notes,
            })),
          },
        },
        include: saleInclude,
      });

      // 7d. Mouvements de stock rattachés à la vente
      await tx.stockMovement.createMany({
        data: [...pricing.baseQtyByProduct].map(([productId, qty]) => ({
          stockId: stockIds.get(productId)!,
          type: "SALE" as const,
          quantity: qty.negated(),
          unitId: pricing.baseUnitByProduct.get(productId),
          referenceType: "Sale",
          referenceId: newSale.id,
          performedById: user.id,
          centerId,
        })),
      });

      // 7e. Journal d'audit dans la même transaction
      await writeAuditLog(
        {
          eventType: "SALE_CREATED",
          companyId,
          centerId,
          userId: user.id,
          referenceType: "Sale",
          referenceId: newSale.id,
          result: "SUCCESS",
          newValues: {
            saleNumber,
            total: pricing.totalAmount.toString(),
            discount: pricing.discountAmount.toString(),
            createdOffline: data.createdOffline ?? false,
          },
          deviceId: data.deviceId,
          sessionId: cashSession.id,
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );

      return newSale;
    });

    return NextResponse.json({ success: true, data: sale }, { status: 201 });
  } catch (error) {
    // Deux envois simultanés de la même vente : la seconde échoue sur la clé
    // d'idempotence → on renvoie la vente créée par la première.
    if (isUniqueViolation(error) && idempotencyKey && companyIdForReplay) {
      try {
        const existing = await findExistingSale(idempotencyKey, companyIdForReplay);
        if (existing) return NextResponse.json({ success: true, data: existing, replayed: true });
      } catch (replayError) {
        return handleApiError(replayError, "SALES");
      }
    }
    return handleApiError(error, "SALES");
  }
}

async function findExistingSale(idempotencyKey: string, companyId: string) {
  const sale = await prisma.sale.findUnique({ where: { idempotencyKey }, include: saleInclude });
  if (!sale) return null;
  // Une clé d'une autre entreprise ne doit rien révéler
  if (sale.companyId !== companyId) throw new ApiError(409, "Clé d'idempotence déjà utilisée", "IDEMPOTENCY_CONFLICT");
  return sale;
}

// ─────────────────────────────────────────────
// GET /api/sales — Lister les ventes (limitées aux centres de l'utilisateur)
// ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:view");
    const companyId = requireCompany(user);

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50") || 50));

    const centerScope = await resolveCenterScope(user, searchParams.get("centerId"));

    const where: Prisma.SaleWhereInput = {
      companyId,
      ...(centerScope ? { centerId: centerScope } : {}),
      // Sans « voir toutes les ventes », un caissier ne voit que les siennes
      ...(hasPermission(user.role, "sale:view_all") ? {} : { cashierId: user.id }),
      ...(sessionId ? { sessionId } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
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
    return handleApiError(error, "SALES");
  }
}
