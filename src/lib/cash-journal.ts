import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Journal de caisse d'une session clôturée
// ─────────────────────────────────────────────
// Même contenu à la fermeture (imprimé ou enregistré par le caissier) et plus
// tard, pour la direction : rien ne se perd, même un an après.

export async function sessionJournal(sessionId: string) {
  const [session, closure, expenses, salesCount] = await Promise.all([
    prisma.cashSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        openingBalance: true,
        notes: true,
        cashier: { select: { firstName: true, lastName: true, role: true } },
        cashRegister: { select: { name: true, centerId: true } },
      },
    }),
    prisma.cashClosure.findUnique({ where: { sessionId } }),
    prisma.expense.findMany({ where: { sessionId }, select: { category: true, description: true, amount: true, date: true }, orderBy: { date: "asc" } }),
    prisma.sale.count({ where: { sessionId, status: { not: "CANCELLED" } } }),
  ]);
  if (!closure) return null;
  return {
    sessionId,
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
      expenses: expenses.map((e) => ({ ...e, amount: e.amount.toString() })),
      notes: session.notes,
    },
  };
}
