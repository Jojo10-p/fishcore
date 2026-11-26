import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Journal de caisse d'une session clôturée
// ─────────────────────────────────────────────
// Même contenu à la fermeture (imprimé ou enregistré par le caissier) et plus
// tard, pour la direction : rien ne se perd, même un an après.

/**
 * withProfit : ajoute le résultat estimé de la journée (bénéfice sur les ventes,
 * dépenses, bénéfice net estimé). Réservé à ceux qui voient les bénéfices
 * (gérant, direction) : le caissier ne voit que l'argent de sa caisse.
 */
export async function sessionJournal(sessionId: string, opts: { withProfit?: boolean } = {}) {
  const [session, closure, expenses, salesCount, cashIn] = await Promise.all([
    prisma.cashSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        openingBalance: true,
        notes: true,
        cashierId: true,
        isValidated: true,
        validatedById: true,
        cashier: { select: { firstName: true, lastName: true, role: true } },
        cashRegister: { select: { name: true, centerId: true } },
      },
    }),
    prisma.cashClosure.findUnique({ where: { sessionId } }),
    prisma.expense.findMany({
      where: { sessionId },
      select: { category: true, description: true, amount: true, date: true, cancelledAt: true },
      orderBy: { date: "asc" },
    }),
    prisma.sale.count({ where: { sessionId, status: { not: "CANCELLED" } } }),
    prisma.cashMovement.aggregate({ where: { sessionId, type: "CASH_IN" }, _sum: { amount: true } }),
  ]);
  if (!closure) return null;
  // Une dépense annulée sort puis rentre dans la caisse : on ne la montre ni en sortie ni en entrée
  const kept = expenses.filter((e) => !e.cancelledAt);
  const cancelledTotal = expenses.filter((e) => e.cancelledAt).reduce((s, e) => s + Number(e.amount), 0);
  const totalExpenses = kept.reduce((s, e) => s + Number(e.amount), 0);
  // Autres sorties (avances, retraits…) et entrées : hors dépenses, déjà comptées à part
  const otherOut = Math.max(0, Number(closure.totalCashOut) - totalExpenses - cancelledTotal);
  const otherIn = Math.max(0, Number(cashIn._sum.amount ?? 0) - cancelledTotal);

  // Résultat estimé : ce que les ventes ont rapporté (prix de vente − prix d'achat), puis − dépenses
  let profit: { revenue: string; costOfSales: string; grossProfit: string; expenses: string; netProfit: string } | undefined;
  if (opts.withProfit) {
    const [sales, cost] = await Promise.all([
      prisma.sale.aggregate({ where: { sessionId, status: { not: "CANCELLED" } }, _sum: { totalAmount: true, taxAmount: true } }),
      prisma.saleLine.aggregate({ where: { sale: { sessionId, status: { not: "CANCELLED" } } }, _sum: { costAmount: true } }),
    ]);
    const revenue = Number(sales._sum.totalAmount ?? 0) - Number(sales._sum.taxAmount ?? 0);
    const costOfSales = Number(cost._sum.costAmount ?? 0);
    const grossProfit = revenue - costOfSales;
    profit = {
      revenue: revenue.toFixed(2),
      costOfSales: costOfSales.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      expenses: totalExpenses.toFixed(2),
      netProfit: (grossProfit - totalExpenses).toFixed(2),
    };
  }
  const validator = session.validatedById
    ? await prisma.user.findUnique({ where: { id: session.validatedById }, select: { firstName: true, lastName: true } })
    : null;
  return {
    sessionId,
    cashierId: session.cashierId,
    isValidated: session.isValidated,
    validatedBy: validator ? `${validator.firstName} ${validator.lastName}`.trim() : null,
    theoreticalBalance: closure.theoreticalBalance.toString(),
    declaredBalance: closure.declaredBalance.toString(),
    discrepancy: closure.discrepancy.toString(),
    totalSales: closure.totalSales.toString(),
    totalRefunds: closure.totalRefunds.toString(),
    journal: {
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      registerName: session.cashRegister.name,
      cashier: session.cashier,
      openingBalance: session.openingBalance.toString(),
      salesCount,
      totalCash: closure.totalCash.toString(),
      totalMobileMoney: closure.totalMobileMoney.toString(),
      totalCard: closure.totalCard.toString(),
      totalOther: closure.totalOther.toString(),
      totalCashOut: closure.totalCashOut.toString(),
      totalCashIn: otherIn.toFixed(2),
      totalRefunds: closure.totalRefunds.toString(),
      totalExpenses: totalExpenses.toFixed(2),
      otherCashOut: otherOut.toFixed(2),
      expenses: kept.map((e) => ({ category: e.category, description: e.description, date: e.date, amount: e.amount.toString() })),
      notes: session.notes,
    },
    profit,
  };
}
