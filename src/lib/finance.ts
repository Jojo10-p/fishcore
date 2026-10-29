import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/auth";

// ─────────────────────────────────────────────
// Créances clients et dettes fournisseurs (cahier §12, §14)
// ─────────────────────────────────────────────
// Créance d'un client = ventes payées « à crédit »
//                       − remboursements de ces crédits (annulations)
//                       − règlements reçus.
// Aucune donnée n'est dupliquée : le solde est toujours recalculé à partir
// des opérations, donc il ne peut pas « dériver ».

type Db = Prisma.TransactionClient;
const D = Prisma.Decimal;

export interface CustomerBalanceRow {
  customerId: string;
  creditSales: Prisma.Decimal;
  creditRefunds: Prisma.Decimal;
  payments: Prisma.Decimal;
  balance: Prisma.Decimal;
  lastCreditAt: Date | null;
}

/** Soldes clients (tous, ou ceux listés), calculés en SQL. */
export async function customerBalances(db: Db, companyId: string, customerIds?: string[]): Promise<Map<string, CustomerBalanceRow>> {
  const filter = customerIds?.length ? Prisma.sql`AND c."id" IN (${Prisma.join(customerIds)})` : Prisma.empty;
  const rows = await db.$queryRaw<
    Array<{ customerId: string; creditSales: Prisma.Decimal; creditRefunds: Prisma.Decimal; payments: Prisma.Decimal; lastCreditAt: Date | null }>
  >`
    SELECT c."id" AS "customerId",
           COALESCE((SELECT SUM(p."amount") FROM "payments" p JOIN "sales" s ON s."id" = p."saleId"
                      WHERE s."customerId" = c."id" AND p."method" = 'CREDIT'), 0) AS "creditSales",
           COALESCE((SELECT SUM(r."amount") FROM "refunds" r JOIN "sales" s ON s."id" = r."saleId"
                      WHERE s."customerId" = c."id" AND r."method" = 'CREDIT'), 0) AS "creditRefunds",
           COALESCE((SELECT SUM(cp."amount") FROM "customer_payments" cp WHERE cp."customerId" = c."id"), 0) AS "payments",
           (SELECT MAX(s."createdAt") FROM "payments" p JOIN "sales" s ON s."id" = p."saleId"
             WHERE s."customerId" = c."id" AND p."method" = 'CREDIT') AS "lastCreditAt"
      FROM "customers" c
     WHERE c."companyId" = ${companyId} ${filter}`;

  return new Map(
    rows.map((r) => {
      const creditSales = new D(r.creditSales);
      const creditRefunds = new D(r.creditRefunds);
      const payments = new D(r.payments);
      return [
        r.customerId,
        { customerId: r.customerId, creditSales, creditRefunds, payments, balance: creditSales.sub(creditRefunds).sub(payments), lastCreditAt: r.lastCreditAt },
      ];
    })
  );
}

/**
 * Vérifie qu'une vente à crédit ne fait pas dépasser le plafond du client.
 * Verrouille la fiche client : deux ventes simultanées ne peuvent pas
 * dépasser ensemble le plafond.
 */
export async function assertCreditAllowed(tx: Db, companyId: string, customerId: string, creditAmount: Prisma.Decimal) {
  const [customer] = await tx.$queryRaw<{ id: string; name: string; creditLimit: Prisma.Decimal | null }[]>`
    SELECT "id", "name", "creditLimit" FROM "customers" WHERE "id" = ${customerId} AND "companyId" = ${companyId} FOR UPDATE`;
  if (!customer) throw new ApiError(400, "Client introuvable");
  if (customer.creditLimit === null) return;
  const balance = (await customerBalances(tx, companyId, [customerId])).get(customerId)?.balance ?? new D(0);
  const after = balance.add(creditAmount);
  if (after.gt(customer.creditLimit)) {
    throw new ApiError(
      409,
      `Plafond de crédit dépassé pour « ${customer.name} » : encours ${balance.toString()}, plafond ${new D(customer.creditLimit).toString()}`,
      "CREDIT_LIMIT"
    );
  }
}

/**
 * Impute un paiement fournisseur sur ses factures, la plus ancienne échéance
 * d'abord (ou sur la facture désignée). Refuse de payer plus que la dette.
 */
export async function allocateSupplierPayment(
  tx: Db,
  params: { companyId: string; supplierId: string; amount: Prisma.Decimal; purchaseId?: string }
): Promise<Array<{ purchaseId: string; amount: string }>> {
  const { companyId, supplierId, amount, purchaseId } = params;
  const purchases = await tx.$queryRaw<{ id: string; totalAmount: Prisma.Decimal; paidAmount: Prisma.Decimal }[]>`
    SELECT "id", "totalAmount", "paidAmount" FROM "purchases"
     WHERE "companyId" = ${companyId} AND "supplierId" = ${supplierId}
       AND "paidAmount" < "totalAmount"
       ${purchaseId ? Prisma.sql`AND "id" = ${purchaseId}` : Prisma.empty}
     ORDER BY "dueDate" ASC NULLS LAST, "createdAt" ASC
       FOR UPDATE`;

  const due = purchases.reduce((s, p) => s.add(new D(p.totalAmount).sub(p.paidAmount)), new D(0));
  if (amount.gt(due)) {
    throw new ApiError(400, `Montant supérieur à la dette${purchaseId ? " de cette facture" : ""} (${due.toString()})`, "OVERPAYMENT");
  }

  let left = amount;
  const allocations: Array<{ purchaseId: string; amount: string }> = [];
  for (const p of purchases) {
    if (left.lte(0)) break;
    const open = new D(p.totalAmount).sub(p.paidAmount);
    const take = D.min(open, left);
    await tx.purchase.update({ where: { id: p.id }, data: { paidAmount: { increment: take } } });
    allocations.push({ purchaseId: p.id, amount: take.toString() });
    left = left.sub(take);
  }
  return allocations;
}

/**
 * Sortie ou entrée d'espèces dans une caisse ouverte (dépense, paiement
 * fournisseur, règlement client). Verrouille la session : impossible de
 * l'imputer à une caisse en cours de clôture.
 */
export async function recordDrawerMovement(
  tx: Db,
  params: {
    companyId: string;
    sessionId: string;
    userId: string;
    type: "CASH_IN" | "CASH_OUT";
    amount: Prisma.Decimal;
    reason: string;
    allowOtherCashier: boolean;
    /** Centres accessibles à l'utilisateur (null = tous ceux de l'entreprise). */
    allowedCenterIds: string[] | null;
  }
): Promise<{ id: string; centerId: string }> {
  const [session] = await tx.$queryRaw<{ id: string; cashierId: string; centerId: string; companyId: string }[]>`
    SELECT cs."id", cs."cashierId", cr."centerId", c."companyId"
      FROM "cash_sessions" cs
      JOIN "cash_registers" cr ON cr."id" = cs."cashRegisterId"
      JOIN "centers" c ON c."id" = cr."centerId"
     WHERE cs."id" = ${params.sessionId} AND cs."closedAt" IS NULL
       FOR UPDATE OF cs`;
  if (!session || session.companyId !== params.companyId) {
    throw new ApiError(409, "Caisse introuvable ou déjà clôturée", "SESSION_CLOSED");
  }
  if (params.allowedCenterIds && !params.allowedCenterIds.includes(session.centerId)) {
    throw new ApiError(403, "Vous n'avez pas accès à cette caisse", "FORBIDDEN");
  }
  if (session.cashierId !== params.userId && !params.allowOtherCashier) {
    throw new ApiError(403, "Cette caisse appartient à un autre caissier", "SESSION_NOT_OWNED");
  }
  const movement = await tx.cashMovement.create({
    data: { sessionId: session.id, type: params.type, amount: params.amount, reason: params.reason, performedById: params.userId },
  });
  return { id: movement.id, centerId: session.centerId };
}
