import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openSessionSchema, closeSessionSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit";

// POST /api/cash/sessions/open — Ouvrir une session de caisse
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as "open" | "close" | "movement";

    if (action === "open") {
      const parsed = openSessionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: parsed.error.errors[0].message },
          { status: 400 }
        );
      }

      const { cashRegisterId, openingBalance, deviceId } = parsed.data;

      // Vérifier qu'il n'y a pas de session déjà ouverte
      const existing = await prisma.cashSession.findFirst({
        where: { cashRegisterId, closedAt: null },
      });
      if (existing) {
        return NextResponse.json(
          {
            success: false,
            error: "Une session est déjà ouverte sur cette caisse. Fermez-la d'abord.",
          },
          { status: 409 }
        );
      }

      // Récupérer le caissier depuis le cookie/token
      // TODO: intégrer avec le système d'auth complet
      const cashierId = body.cashierId as string;
      if (!cashierId) {
        return NextResponse.json(
          { success: false, error: "Identifiant caissier requis" },
          { status: 400 }
        );
      }

      const session = await prisma.cashSession.create({
        data: {
          cashRegisterId,
          cashierId,
          openingBalance,
          deviceId,
          connectionState: body.isOnline ? "ONLINE" : "OFFLINE",
        },
        include: {
          cashRegister: { select: { name: true, centerId: true } },
          cashier: { select: { firstName: true, lastName: true } },
        },
      });

      await writeAuditLog({
        eventType: "CASH_SESSION_OPENED",
        userId: cashierId,
        centerId: session.cashRegister.centerId,
        referenceType: "CashSession",
        referenceId: session.id,
        result: "SUCCESS",
      });

      return NextResponse.json({ success: true, data: session }, { status: 201 });
    }

    if (action === "close") {
      const parsed = closeSessionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: parsed.error.errors[0].message },
          { status: 400 }
        );
      }

      const { sessionId, declaredBalance, notes } = parsed.data;

      const session = await prisma.cashSession.findUnique({
        where: { id: sessionId },
        include: {
          sales: { include: { payments: true } },
          cashMovements: true,
          cashRegister: { select: { centerId: true } },
        },
      });

      if (!session) {
        return NextResponse.json({ success: false, error: "Session introuvable" }, { status: 404 });
      }
      if (session.closedAt) {
        return NextResponse.json({ success: false, error: "Session déjà fermée" }, { status: 409 });
      }

      // Calculer les totaux par mode de paiement
      let totalSales = 0, totalCash = 0, totalMobileMoney = 0, totalCard = 0, totalOther = 0;
      for (const sale of session.sales) {
        for (const payment of sale.payments) {
          const amount = Number(payment.amount);
          totalSales += amount;
          if (payment.method === "CASH") totalCash += amount;
          else if (payment.method === "MOBILE_MONEY") totalMobileMoney += amount;
          else if (payment.method === "CARD") totalCard += amount;
          else totalOther += amount;
        }
      }

      const totalCashOut = session.cashMovements
        .filter((m) => m.type === "CASH_OUT")
        .reduce((s, m) => s + Number(m.amount), 0);
      const totalCashIn = session.cashMovements
        .filter((m) => m.type === "CASH_IN")
        .reduce((s, m) => s + Number(m.amount), 0);

      const theoreticalBalance =
        Number(session.openingBalance) + totalCash + totalCashIn - totalCashOut;
      const discrepancy = declaredBalance - theoreticalBalance;

      // Clôturer la session dans une transaction
      await prisma.$transaction(async (tx) => {
        await tx.cashSession.update({
          where: { id: sessionId },
          data: {
            closedAt: new Date(),
            closingBalance: declaredBalance,
            theoreticalBalance,
            discrepancy,
            notes,
          },
        });

        await tx.cashClosure.create({
          data: {
            sessionId,
            openingBalance: Number(session.openingBalance),
            totalSales,
            totalCash,
            totalMobileMoney,
            totalCard,
            totalOther,
            totalRefunds: 0, // TODO: calculer les remboursements
            totalCashOut,
            theoreticalBalance,
            declaredBalance,
            discrepancy,
            cashierId: session.cashierId,
            notes,
          },
        });
      });

      await writeAuditLog({
        eventType: "CASH_SESSION_CLOSED",
        userId: session.cashierId,
        centerId: session.cashRegister.centerId,
        referenceType: "CashSession",
        referenceId: sessionId,
        result: "SUCCESS",
        newValues: { totalSales, declaredBalance, discrepancy },
      });

      return NextResponse.json({
        success: true,
        data: { sessionId, theoreticalBalance, declaredBalance, discrepancy, totalSales },
      });
    }

    if (action === "movement") {
      const { sessionId, type, amount, reason, performedById } = body;

      const movement = await prisma.cashMovement.create({
        data: {
          sessionId,
          type,
          amount,
          reason,
          performedById: performedById ?? "unknown",
        },
      });

      return NextResponse.json({ success: true, data: movement }, { status: 201 });
    }

    return NextResponse.json({ success: false, error: "Action invalide" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET /api/cash/sessions — Lister les sessions d'une caisse
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cashRegisterId = searchParams.get("cashRegisterId");
  const centerId = searchParams.get("centerId");

  const sessions = await prisma.cashSession.findMany({
    where: {
      ...(cashRegisterId ? { cashRegisterId } : {}),
      ...(centerId ? { cashRegister: { centerId } } : {}),
    },
    include: {
      cashier: { select: { firstName: true, lastName: true } },
      cashRegister: { select: { name: true } },
      closure: true,
    },
    orderBy: { openedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ success: true, data: sessions });
}
