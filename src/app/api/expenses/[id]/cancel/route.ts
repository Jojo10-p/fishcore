import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

// POST /api/expenses/[id]/cancel — Annuler une dépense saisie par erreur.
// La dépense n'est jamais supprimée (traçabilité). Si elle était sortie d'une
// caisse encore ouverte, l'argent y est remis par une entrée de caisse.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "expense:cancel");
    const companyId = requireCompany(user);
    const { id } = await params;
    const { reason } = parseBody(z.object({ reason: z.string().trim().min(3, "Motif obligatoire") }), await readJson(req));

    const expense = await prisma.expense.findFirst({ where: { id, companyId } });
    if (!expense) throw new ApiError(404, "Dépense introuvable");
    await requireCenterAccess(user, expense.centerId);
    if (expense.isCancelled) throw new ApiError(409, "Dépense déjà annulée", "ALREADY_CANCELLED");

    await prisma.$transaction(async (tx) => {
      const done = await tx.expense.updateMany({
        where: { id, isCancelled: false },
        data: { isCancelled: true, cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason },
      });
      if (done.count === 0) throw new ApiError(409, "Dépense déjà annulée", "ALREADY_CANCELLED");

      let reversedInDrawer = false;
      if (expense.sessionId) {
        const open = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "cash_sessions" WHERE "id" = ${expense.sessionId} AND "closedAt" IS NULL FOR UPDATE`;
        if (open.length) {
          await tx.cashMovement.create({
            data: { sessionId: expense.sessionId, type: "CASH_IN", amount: expense.amount, reason: `Annulation dépense : ${reason}`, performedById: user.id },
          });
          reversedInDrawer = true;
        }
      }

      await writeAuditLog(
        {
          eventType: "EXPENSE_CANCELLED",
          companyId,
          centerId: expense.centerId,
          userId: user.id,
          referenceType: "Expense",
          referenceId: id,
          result: "SUCCESS",
          reason,
          oldValues: { amount: expense.amount.toString(), category: expense.category },
          newValues: { cancelled: true, reversedInDrawer },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
    });

    return NextResponse.json({ success: true, message: "Dépense annulée." });
  } catch (error) {
    return handleApiError(error, "EXPENSES");
  }
}
