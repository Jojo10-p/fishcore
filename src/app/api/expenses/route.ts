import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
  resolveCenterScope,
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { recordDrawerMovement } from "@/lib/finance";

const expenseSchema = z.object({
  centerId: z.string().min(1),
  category: z.string().trim().min(2, "Catégorie requise").max(60),
  amount: z.coerce.number().positive("Montant invalide"),
  date: z.coerce.date().optional(),
  description: z.string().trim().max(300).optional(),
  payee: z.string().trim().max(100).optional(),
  method: z.enum(["CASH", "MOBILE_MONEY", "CARD", "TRANSFER"]).default("CASH"),
  reference: z.string().trim().max(100).optional(),
  /** Espèces prises dans une caisse ouverte : sortie de caisse automatique. */
  sessionId: z.string().optional(),
});

// GET /api/expenses?from=…&to=…&centerId=…&category=… — Dépenses
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "expense:view");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const centerScope = await resolveCenterScope(user, sp.get("centerId"));
    const from = sp.get("from");
    const to = sp.get("to");
    const category = sp.get("category");

    const expenses = await prisma.expense.findMany({
      where: {
        companyId,
        ...(centerScope ? { centerId: centerScope } : {}),
        ...(category ? { category } : {}),
        ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
      include: { center: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 500,
    });
    return NextResponse.json({ success: true, data: expenses });
  } catch (error) {
    return handleApiError(error, "EXPENSES");
  }
}

// POST /api/expenses — Enregistrer une dépense
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "expense:create");
    const companyId = requireCompany(user);
    const data = parseBody(expenseSchema, await readJson(req));
    await requireCenterAccess(user, data.centerId);
    if (data.sessionId && data.method !== "CASH") throw new ApiError(400, "Seules les espèces sortent du tiroir-caisse");
    if (data.date && data.date.getTime() > Date.now() + 24 * 3600 * 1000) throw new ApiError(400, "Date de dépense dans le futur");

    const amount = new Prisma.Decimal(data.amount);
    const expense = await prisma.$transaction(async (tx) => {
      let cashMovementId: string | undefined;
      if (data.sessionId) {
        const mv = await recordDrawerMovement(tx, {
          companyId,
          sessionId: data.sessionId,
          userId: user.id,
          allowedCenterIds: user.role === "COMPANY_OWNER" ? null : user.centerIds,
          type: "CASH_OUT",
          amount,
          reason: `Dépense : ${data.category}${data.description ? ` — ${data.description}` : ""}`,
          allowOtherCashier: hasPermission(user.role, "cash:close_session_validate"),
        });
        if (mv.centerId !== data.centerId) throw new ApiError(400, "La caisse doit appartenir au centre de la dépense");
        cashMovementId = mv.id;
      }

      const created = await tx.expense.create({
        data: {
          companyId,
          centerId: data.centerId,
          category: data.category,
          amount,
          date: data.date ?? new Date(),
          description: data.description,
          payee: data.payee,
          method: data.method,
          reference: data.reference,
          sessionId: data.sessionId,
          cashMovementId,
          createdById: user.id,
        },
      });

      await writeAuditLog(
        {
          eventType: "EXPENSE_RECORDED",
          companyId,
          centerId: data.centerId,
          userId: user.id,
          referenceType: "Expense",
          referenceId: created.id,
          result: "SUCCESS",
          newValues: { category: data.category, amount: amount.toString(), method: data.method, fromDrawer: !!data.sessionId },
          sessionId: data.sessionId,
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return created;
    });

    return NextResponse.json({ success: true, data: expense }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "EXPENSES");
  }
}
