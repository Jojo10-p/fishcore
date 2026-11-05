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
import { priceLines, settlePayments } from "@/lib/sales";
import { consumeStockForSale, type BatchAllocation } from "@/lib/stock";
import { nextCompanyNumber, resolveSessionNumber } from "@/lib/invoice-numbers";
import { scheduleStockAlerts } from "@/lib/stock-alerts";


// Lignes dans l'ordre de saisie (identifiants croissants)
const saleInclude = { lines: { orderBy: { id: "asc" } }, payments: true } satisfies Prisma.SaleInclude;

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
        openedAt: true,
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

    // 3. Vente issue d'un devis : lignes, prix, remises et client repris du devis
    let quoteId: string | null = null;
    let fixedPrices = false;
    if (data.quoteId) {
      const quote = await prisma.quote.findFirst({
        where: { id: data.quoteId, companyId },
        select: {
          id: true,
          number: true,
          status: true,
          validUntil: true,
          customerId: true,
          lines: { orderBy: { position: "asc" }, select: { productId: true, unitId: true, quantity: true, unitPrice: true, discount: true } },
        },
      });
      if (!quote) throw new ApiError(404, "Devis introuvable");
      assertQuoteConvertible(quote);
      quoteId = quote.id;
      fixedPrices = true;
      data.customerId = quote.customerId;
      data.lines = quote.lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discount: Number(l.discount),
      }));
    }

    // 3b. Client éventuel : doit appartenir à l'entreprise
    if (data.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, companyId },
        select: { id: true },
      });
      if (!customer) throw new ApiError(400, "Client introuvable");
    }

    // 4. Remises : réservées aux rôles autorisés (celles d'un devis ont été
    //    accordées par un rôle autorisé à sa création)
    const hasDiscount = !fixedPrices && data.lines.some((l) => (l.discount ?? 0) > 0);
    if (hasDiscount) await requirePermission(user, "sale:discount");

    // 5. Calcul des lignes à partir des prix et unités EN BASE
    const pricing = await priceLines(companyId, data.lines, data.createdOffline, { fixedPrices });
    const { requiresPickup } = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { requiresPickup: true } });

    // 6. Paiements : la somme doit couvrir le total ; l'excédent n'est admis
    //    que sous forme de rendu monnaie sur les espèces.
    const payments = settlePayments(data.payments, pricing.totalAmount);
    // Espèces : ce que le client a remis et la monnaie rendue (pour le ticket)
    const tendered = data.payments.filter((p) => p.method === "CASH").reduce((s, p) => s + Number(p.amount), 0);
    const paidTotal = data.payments.reduce((s, p) => s + Number(p.amount), 0);
    const changeGiven = Math.max(0, Math.round((paidTotal - Number(pricing.totalAmount)) * 100) / 100);

    // Heure d'une vente hors connexion : acceptée si elle tombe pendant la session
    const soldAt =
      data.createdOffline && data.soldAt
        ? (() => {
            const t = new Date(data.soldAt);
            const min = cashSession.openedAt.getTime() - 60_000;
            const max = Date.now() + 5 * 60_000;
            return t.getTime() >= min && t.getTime() <= max ? t : undefined;
          })()
        : undefined;

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

      // 7.1 Devis verrouillé : deux caisses ne peuvent pas encaisser le même devis
      if (quoteId) {
        const [locked] = await tx.$queryRaw<{ status: string; validUntil: Date; number: string }[]>`
          SELECT "status", "validUntil", "number" FROM "quotes" WHERE "id" = ${quoteId} FOR UPDATE`;
        assertQuoteConvertible(locked);
      }

      // 7a. Sortie de stock : réserve de la session d'abord, puis stock libre.
      //     Produits traités dans un ordre fixe pour éviter les interblocages.
      //     Produits suivis par lot : lots non périmés, premier périmé premier sorti.
      const outputs = new Map<string, { stockId: string; allocations: BatchAllocation[]; cost: Prisma.Decimal }>();
      const regularizations: Array<{ stockId: string; productId: string; qty: Prisma.Decimal }> = [];
      const productOrder = [...pricing.baseQtyByProduct.keys()].sort();
      for (const productId of productOrder) {
        const qty = pricing.baseQtyByProduct.get(productId)!;
        const { stockId, allocations, avgCost, regularized } = await consumeStockForSale(tx, {
          centerId,
          productId,
          qty,
          sessionId: cashSession.id,
          productName: pricing.productNames.get(productId) ?? productId,
          trackBatches: pricing.productInfo.get(productId)?.trackBatches ?? false,
          // Vente faite hors connexion : la marchandise est partie, on ne la refuse pas
          regularizeShortfall: data.createdOffline,
        });
        if (regularized.gt(0)) regularizations.push({ stockId, productId, qty: regularized });
        // Coût des marchandises vendues : coût du lot si suivi par lot, sinon CMP du stock
        // (à défaut, prix d'achat de la fiche produit)
        const fallback = avgCost.gt(0) ? avgCost : pricing.productInfo.get(productId)!.purchasePrice;
        const cost = allocations.length
          ? allocations.reduce((s, a) => s.add(a.quantity.mul(a.unitCost ?? fallback)), new Prisma.Decimal(0))
          : qty.mul(fallback);
        outputs.set(productId, { stockId, allocations, cost });
      }

      // Coût réparti sur les lignes du même produit au prorata des quantités.
      // Sans retrait au magasin, la marchandise est remise sur-le-champ.
      const linesWithCost = pricing.lines.map((l) => {
        const out = outputs.get(l.productId)!;
        const totalQty = pricing.baseQtyByProduct.get(l.productId)!;
        return {
          ...l,
          costAmount: out.cost.mul(l.baseQuantity).div(totalQty).toDecimalPlaces(2),
          deliveredQuantity: requiresPickup ? new Prisma.Decimal(0) : l.quantity,
        };
      });

      // 7b. Numéro de facture : celui que la caisse a déjà imprimé (pris dans sa
      //     plage), sinon la suite du compteur de l'entreprise (ligne verrouillée)
      const { seq: invoiceSeq, saleNumber } = data.invoiceSeq
        ? await resolveSessionNumber(tx, { sessionId: cashSession.id, seq: data.invoiceSeq })
        : await nextCompanyNumber(tx, companyId);

      // 7c. Vente + lignes + paiements
      const newSale = await tx.sale.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          companyId,
          centerId,
          sessionId: cashSession.id,
          cashierId: user.id,
          customerId: data.customerId,
          customerName: data.customerName || null,
          amountTendered: tendered > 0 ? tendered : null,
          changeGiven: tendered > 0 ? changeGiven : null,
          saleNumber,
          invoiceSeq,
          subtotal: pricing.subtotal,
          discountAmount: pricing.discountAmount,
          totalAmount: pricing.totalAmount,
          taxAmount: pricing.taxAmount,
          notes: data.notes,
          deliveryStatus: requiresPickup ? "PENDING" : "DELIVERED",
          // Vente hors connexion : la date est celle de la vente, pas celle de l'envoi
          ...(soldAt ? { createdAt: soldAt } : {}),
          createdOffline: data.createdOffline ?? false,
          deviceId: data.deviceId,
          syncedAt: new Date(),
          lines: { create: linesWithCost },
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

      // 7d. Mouvements de stock rattachés à la vente (un par lot pour la traçabilité :
      //     en cas de rappel d'un lot, on retrouve chaque vente concernée)
      await tx.stockMovement.createMany({
        data: [...pricing.baseQtyByProduct].flatMap(([productId, qty]) => {
          const { stockId, allocations } = outputs.get(productId)!;
          const base = {
            stockId,
            type: "SALE" as const,
            unitId: pricing.baseUnitByProduct.get(productId),
            referenceType: "Sale",
            referenceId: newSale.id,
            performedById: user.id,
            centerId,
          };
          return allocations.length
            ? allocations.map((a) => ({ ...base, quantity: a.quantity.negated(), batchId: a.batchId }))
            : [{ ...base, quantity: qty.negated() }];
        }),
      });

      if (quoteId) {
        await tx.quote.update({ where: { id: quoteId }, data: { status: "CONVERTED", saleId: newSale.id } });
      }

      // 7d-bis. Écart constaté par une vente hors connexion : ajustement tracé, à vérifier à l'inventaire
      if (regularizations.length > 0) {
        await tx.stockMovement.createMany({
          data: regularizations.map((r) => ({
            stockId: r.stockId,
            type: "INVENTORY_ADJUST" as const,
            quantity: r.qty,
            unitId: pricing.baseUnitByProduct.get(r.productId),
            referenceType: "Sale",
            referenceId: newSale.id,
            notes: `Écart constaté : vendu hors connexion au-delà du stock enregistré (facture ${saleNumber})`,
            performedById: user.id,
            centerId,
          })),
        });
        await writeAuditLog(
          {
            eventType: "STOCK_ADJUSTED",
            companyId,
            centerId,
            userId: user.id,
            referenceType: "Sale",
            referenceId: newSale.id,
            result: "SUCCESS",
            reason: `Vente hors connexion ${saleNumber} au-delà du stock enregistré : écart régularisé`,
            newValues: Object.fromEntries(regularizations.map((r) => [pricing.productNames.get(r.productId) ?? r.productId, r.qty.toString()])),
            deviceId: data.deviceId,
            sessionId: cashSession.id,
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
      }

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
            tax: pricing.taxAmount.toString(),
            createdOffline: data.createdOffline ?? false,
            ...(quoteId ? { quoteId } : {}),
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

    scheduleStockAlerts(companyId);
    return NextResponse.json({ success: true, data: sale }, { status: 201 });
  } catch (error) {
    // Deux envois simultanés de la même vente : la seconde échoue sur la clé
    // d'idempotence → on renvoie la vente créée par la première.
    if (isUniqueViolation(error) && idempotencyKey && companyIdForReplay) {
      try {
        const existing = await findExistingSale(idempotencyKey, companyIdForReplay);
        if (existing) return NextResponse.json({ success: true, data: existing, replayed: true });
        // Même numéro de facture envoyé en même temps par une autre vente
        return handleApiError(new ApiError(409, "Ce numéro de facture vient d'être utilisé", "INVOICE_NUMBER_USED"), "SALES");
      } catch (replayError) {
        return handleApiError(replayError, "SALES");
      }
    }
    return handleApiError(error, "SALES");
  }
}

/** Un devis ne s'encaisse qu'une fois, s'il n'est ni annulé ni expiré. */
function assertQuoteConvertible(quote: { status: string; validUntil: Date; number: string }) {
  if (quote.status === "CONVERTED") throw new ApiError(409, `Le devis ${quote.number} a déjà été encaissé`, "QUOTE_CONVERTED");
  if (quote.status === "CANCELLED") throw new ApiError(409, `Le devis ${quote.number} est annulé`, "QUOTE_CANCELLED");
  if (quote.validUntil.getTime() < Date.now()) {
    throw new ApiError(409, `Le devis ${quote.number} a expiré : établissez un nouveau devis aux prix du jour`, "QUOTE_EXPIRED");
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
    const search = searchParams.get("search")?.trim();
    const delivery = searchParams.get("deliveryStatus");
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
      ...(search
        ? { OR: [{ saleNumber: { contains: search, mode: "insensitive" } }, { customer: { name: { contains: search, mode: "insensitive" } } }] }
        : {}),
      ...(delivery === "PENDING" ? { deliveryStatus: { in: ["PENDING", "PARTIAL"] }, status: { not: "CANCELLED" } } : {}),
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
          lines: { orderBy: { id: "asc" }, include: { product: { select: { name: true } } } },
          payments: true,
          cashier: { select: { firstName: true, lastName: true } },
          customer: { select: { name: true, phone: true } },
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
