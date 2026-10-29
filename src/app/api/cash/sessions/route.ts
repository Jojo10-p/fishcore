import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { closeSessionSchema, openSessionSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  type AuthUser,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
  resolveCenterScope,
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { releaseSessionNumbers } from "@/lib/invoice-numbers";
import { releaseSessionReservations } from "@/lib/stock";

const D = Prisma.Decimal;

const cashMovementSchema = z.object({
  sessionId: z.string().min(1),
  type: z.enum(["CASH_IN", "CASH_OUT", "ADVANCE"]),
  amount: z.coerce.number().positive("Montant invalide"),
  reason: z.string().trim().min(3, "Motif requis"),
});

const validateClosureSchema = z.object({
  sessionId: z.string().min(1),
  notes: z.string().optional(),
});

/** Charge une session en vérifiant entreprise + centre. */
async function loadSession(user: AuthUser, sessionId: string) {
  const companyId = requireCompany(user);
  const session = await prisma.cashSession.findFirst({
    where: { id: sessionId, cashRegister: { center: { companyId } } },
    include: { cashRegister: { select: { id: true, centerId: true } } },
  });
  if (!session) throw new ApiError(404, "Session introuvable");
  await requireCenterAccess(user, session.cashRegister.centerId);
  return session;
}

// ─────────────────────────────────────────────
// POST /api/cash/sessions (cahier §7)
//   { action: "open", cashRegisterId, openingBalance, deviceId?, isOnline? }
//   { action: "close", sessionId, declaredBalance, notes? }
//   { action: "validate", sessionId, notes? }   → validation de la clôture par un responsable
//   { action: "movement", sessionId, type, amount, reason }
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const companyId = requireCompany(user);
    const body = await readJson(req);
    const meta = { ipAddress: user.ipAddress, userAgent: user.userAgent };

    // ── Ouverture ───────────────────────────────
    if (body.action === "open") {
      await requirePermission(user, "cash:open_session");
      const { cashRegisterId, openingBalance, deviceId } = parseBody(openSessionSchema, body);

      const register = await prisma.cashRegister.findFirst({
        where: { id: cashRegisterId, center: { companyId } },
        select: { id: true, centerId: true, isActive: true, state: true },
      });
      if (!register) throw new ApiError(404, "Caisse introuvable");
      await requireCenterAccess(user, register.centerId);
      if (!register.isActive || register.state === "INACTIVE") {
        throw new ApiError(409, "Cette caisse est désactivée", "REGISTER_INACTIVE");
      }

      const session = await prisma.$transaction(async (tx) => {
        // Verrou sur la caisse : deux ouvertures simultanées ne peuvent pas réussir
        await tx.$executeRaw`SELECT 1 FROM "cash_registers" WHERE "id" = ${cashRegisterId} FOR UPDATE`;

        const openOnRegister = await tx.cashSession.findFirst({
          where: { cashRegisterId, closedAt: null },
          select: { id: true },
        });
        if (openOnRegister) {
          throw new ApiError(409, "Une session est déjà ouverte sur cette caisse. Fermez-la d'abord.", "REGISTER_BUSY");
        }
        const openForCashier = await tx.cashSession.findFirst({
          where: { cashierId: user.id, closedAt: null },
          select: { id: true },
        });
        if (openForCashier) {
          throw new ApiError(409, "Vous avez déjà une session ouverte sur une autre caisse.", "CASHIER_BUSY");
        }

        const created = await tx.cashSession.create({
          data: {
            cashRegisterId,
            cashierId: user.id,
            openingBalance,
            deviceId,
            connectionState: body.isOnline === false ? "OFFLINE" : "ONLINE",
          },
          include: {
            cashRegister: { select: { name: true, centerId: true } },
            cashier: { select: { firstName: true, lastName: true } },
          },
        });
        await tx.cashRegister.update({ where: { id: cashRegisterId }, data: { state: "OPEN" } });

        await writeAuditLog(
          {
            eventType: "CASH_SESSION_OPENED",
            companyId,
            centerId: register.centerId,
            userId: user.id,
            referenceType: "CashSession",
            referenceId: created.id,
            result: "SUCCESS",
            newValues: { openingBalance, cashRegisterId },
            deviceId,
            sessionId: created.id,
            ...meta,
          },
          tx
        );
        return created;
      });

      return NextResponse.json({ success: true, data: session }, { status: 201 });
    }

    // ── Clôture ─────────────────────────────────
    if (body.action === "close") {
      await requirePermission(user, "cash:close_session");
      const { sessionId, declaredBalance, notes } = parseBody(closeSessionSchema, body);
      const session = await loadSession(user, sessionId);

      // Un caissier clôture sa propre session ; un responsable peut clôturer celles de son centre
      if (session.cashierId !== user.id && !hasPermission(user.role, "cash:close_session_validate")) {
        throw new ApiError(403, "Vous ne pouvez clôturer que votre propre session", "FORBIDDEN");
      }
      if (session.closedAt) throw new ApiError(409, "Session déjà clôturée", "ALREADY_CLOSED");

      const result = await prisma.$transaction(async (tx) => {
        // Fige la session : plus aucune vente ne peut s'y rattacher pendant le calcul
        const locked = await tx.cashSession.updateMany({
          where: { id: sessionId, closedAt: null },
          data: { closedAt: new Date() },
        });
        if (locked.count === 0) throw new ApiError(409, "Session déjà clôturée", "ALREADY_CLOSED");

        const totals = await computeSessionTotals(tx, sessionId, session.openingBalance);
        const declared = new D(declaredBalance);
        const discrepancy = declared.sub(totals.theoreticalBalance);

        await tx.cashSession.update({
          where: { id: sessionId },
          data: {
            closingBalance: declared,
            theoreticalBalance: totals.theoreticalBalance,
            discrepancy,
            notes,
          },
        });

        await tx.cashClosure.create({
          data: {
            sessionId,
            openingBalance: session.openingBalance,
            totalSales: totals.totalSales,
            totalCash: totals.totalCash,
            totalMobileMoney: totals.totalMobileMoney,
            totalCard: totals.totalCard,
            totalOther: totals.totalOther,
            totalRefunds: totals.totalRefunds,
            totalCashOut: totals.totalCashOut,
            theoreticalBalance: totals.theoreticalBalance,
            declaredBalance: declared,
            discrepancy,
            cashierId: session.cashierId,
            notes,
          },
        });

        await tx.cashRegister.update({ where: { id: session.cashRegisterId }, data: { state: "CLOSED" } });

        // Numéros de facture non utilisés : rendus (aucun trou dans la numérotation)
        const numbers = await releaseSessionNumbers(tx, { companyId, sessionId });

        // Les réserves hors ligne non consommées retournent au stock libre
        const released = await releaseSessionReservations(tx, sessionId);
        if (released.length > 0) {
          await writeAuditLog(
            {
              eventType: "STOCK_RESERVATION_RELEASED",
              companyId,
              centerId: session.cashRegister.centerId,
              userId: user.id,
              referenceType: "CashSession",
              referenceId: sessionId,
              result: "SUCCESS",
              reason: "Clôture de caisse",
              newValues: { released },
              sessionId,
              ...meta,
            },
            tx
          );
        }

        await writeAuditLog(
          {
            eventType: "CASH_SESSION_CLOSED",
            companyId,
            centerId: session.cashRegister.centerId,
            userId: user.id,
            referenceType: "CashSession",
            referenceId: sessionId,
            result: "SUCCESS",
            newValues: {
              cashierId: session.cashierId,
              totalSales: totals.totalSales.toString(),
              theoreticalBalance: totals.theoreticalBalance.toString(),
              declaredBalance: declared.toString(),
              discrepancy: discrepancy.toString(),
              invoicesNumbered: numbers.used,
              invoiceNumbersReturned: numbers.returned.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", "),
            },
            sessionId,
            ...meta,
          },
          tx
        );

        return { ...totals, declaredBalance: declared, discrepancy };
      });

      return NextResponse.json({
        success: true,
        data: {
          sessionId,
          theoreticalBalance: result.theoreticalBalance,
          declaredBalance: result.declaredBalance,
          discrepancy: result.discrepancy,
          totalSales: result.totalSales,
          totalRefunds: result.totalRefunds,
        },
      });
    }

    // ── Validation de la clôture (contrôle indépendant) ─
    if (body.action === "validate") {
      await requirePermission(user, "cash:close_session_validate");
      const { sessionId, notes } = parseBody(validateClosureSchema, body);
      const session = await loadSession(user, sessionId);

      if (!session.closedAt) throw new ApiError(409, "La session n'est pas encore clôturée", "NOT_CLOSED");
      if (session.cashierId === user.id) {
        throw new ApiError(403, "La clôture doit être validée par une autre personne que le caissier", "SELF_APPROVAL");
      }

      await prisma.$transaction(async (tx) => {
        const updated = await tx.cashSession.updateMany({
          where: { id: sessionId, isValidated: false },
          data: { isValidated: true, validatedById: user.id },
        });
        if (updated.count === 0) throw new ApiError(409, "Clôture déjà validée", "ALREADY_VALIDATED");
        await tx.cashClosure.update({ where: { sessionId }, data: { validatedById: user.id } });
        await writeAuditLog(
          {
            eventType: "CASH_CLOSURE_VALIDATED",
            companyId,
            centerId: session.cashRegister.centerId,
            userId: user.id,
            referenceType: "CashSession",
            referenceId: sessionId,
            result: "SUCCESS",
            reason: notes,
            newValues: { discrepancy: session.discrepancy?.toString() ?? null },
            sessionId,
            ...meta,
          },
          tx
        );
      });

      return NextResponse.json({ success: true, message: "Clôture validée." });
    }

    // ── Entrée / sortie de caisse ───────────────
    if (body.action === "movement") {
      await requirePermission(user, "cash:movement");
      const { sessionId, type, amount, reason } = parseBody(cashMovementSchema, body);
      const session = await loadSession(user, sessionId);
      if (session.closedAt) throw new ApiError(409, "Session clôturée", "ALREADY_CLOSED");

      const movement = await prisma.$transaction(async (tx) => {
        const created = await tx.cashMovement.create({
          data: { sessionId, type, amount, reason, performedById: user.id },
        });
        await writeAuditLog(
          {
            eventType: "CASH_MOVEMENT_RECORDED",
            companyId,
            centerId: session.cashRegister.centerId,
            userId: user.id,
            referenceType: "CashMovement",
            referenceId: created.id,
            result: "SUCCESS",
            reason,
            newValues: { type, amount },
            sessionId,
            ...meta,
          },
          tx
        );
        return created;
      });

      return NextResponse.json({ success: true, data: movement }, { status: 201 });
    }

    throw new ApiError(400, "Action invalide");
  } catch (error) {
    return handleApiError(error, "CASH");
  }
}

/**
 * Solde théorique = fond de caisse + encaissements espèces
 *                   − remboursements espèces + entrées − sorties/avances.
 * Les ventes annulées restent comptées en encaissement : leur remboursement
 * est une opération distincte (cahier §10.3), déduite de la caisse qui a
 * effectivement rendu l'argent (Refund.sessionId).
 */
async function computeSessionTotals(
  tx: Prisma.TransactionClient,
  sessionId: string,
  openingBalance: Prisma.Decimal
) {
  const [payments, refunds, movements] = await Promise.all([
    tx.payment.groupBy({
      by: ["method"],
      where: { sale: { sessionId } },
      _sum: { amount: true },
    }),
    // Remboursements sortis de CETTE caisse (pas forcément des ventes de cette session)
    tx.refund.groupBy({
      by: ["method"],
      where: { sessionId },
      _sum: { amount: true },
    }),
    tx.cashMovement.groupBy({
      by: ["type"],
      where: { sessionId },
      _sum: { amount: true },
    }),
  ]);

  const sumOf = (rows: { _sum: { amount: Prisma.Decimal | null } }[]) =>
    rows.reduce((s, r) => s.add(r._sum.amount ?? 0), new D(0));
  const byMethod = (m: string) => new D(payments.find((p) => p.method === m)?._sum.amount ?? 0);
  const movementOf = (t: string) => new D(movements.find((m) => m.type === t)?._sum.amount ?? 0);

  const totalSales = sumOf(payments);
  const totalCash = byMethod("CASH");
  const totalMobileMoney = byMethod("MOBILE_MONEY");
  const totalCard = byMethod("CARD");
  const totalOther = totalSales.sub(totalCash).sub(totalMobileMoney).sub(totalCard);
  const totalRefunds = sumOf(refunds);
  const cashRefunds = new D(refunds.find((r) => r.method === "CASH")?._sum.amount ?? 0);
  const totalCashIn = movementOf("CASH_IN");
  const totalCashOut = movementOf("CASH_OUT").add(movementOf("ADVANCE"));

  const theoreticalBalance = new D(openingBalance)
    .add(totalCash)
    .sub(cashRefunds)
    .add(totalCashIn)
    .sub(totalCashOut);

  return {
    totalSales,
    totalCash,
    totalMobileMoney,
    totalCard,
    totalOther,
    totalRefunds,
    totalCashOut,
    theoreticalBalance,
  };
}

// GET /api/cash/sessions — Sessions visibles par l'utilisateur
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "cash:view_session");
    const companyId = requireCompany(user);

    const { searchParams } = new URL(req.url);
    const cashRegisterId = searchParams.get("cashRegisterId");
    const centerScope = await resolveCenterScope(user, searchParams.get("centerId"));

    const sessions = await prisma.cashSession.findMany({
      where: {
        cashRegister: { center: { companyId }, ...(centerScope ? { centerId: centerScope } : {}) },
        ...(cashRegisterId ? { cashRegisterId } : {}),
        ...(searchParams.get("open") === "true" ? { closedAt: null } : {}),
        // Sans vue globale, un caissier ne voit que ses sessions
        ...(hasPermission(user.role, "cash:view_all_sessions") ? {} : { cashierId: user.id }),
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
  } catch (error) {
    return handleApiError(error, "CASH");
  }
}
