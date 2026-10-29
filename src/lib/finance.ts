import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/auth";

// ─────────────────────────────────────────────
// Dettes fournisseurs (cahier §12) et mouvements d'espèces en caisse
// ─────────────────────────────────────────────

type Db = Prisma.TransactionClient;
const D = Prisma.Decimal;

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
 * fournisseur). Verrouille la session : impossible de
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
