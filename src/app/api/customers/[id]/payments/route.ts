import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
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
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { customerBalances, recordDrawerMovement } from "@/lib/finance";

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Montant invalide"),
  method: z.enum(["CASH", "MOBILE_MONEY", "CARD", "TRANSFER"]),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(300).optional(),
  /** Caisse ouverte qui encaisse les espèces (sinon : hors caisse, ex. versement en banque). */
  sessionId: z.string().optional(),
  idempotencyKey: z.string().min(8),
});

// POST /api/customers/[id]/payments — Règlement d'un client sur son crédit
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let idempotencyKey: string | undefined;
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "customer:payment");
    const companyId = requireCompany(user);
    const { id: customerId } = await params;
    const data = parseBody(paymentSchema, await readJson(req));
    idempotencyKey = data.idempotencyKey;

    const existing = await prisma.customerPayment.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
    if (existing) {
      if (existing.companyId !== companyId) throw new ApiError(409, "Clé déjà utilisée", "IDEMPOTENCY_CONFLICT");
      return NextResponse.json({ success: true, data: existing, replayed: true });
    }

    const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true, name: true } });
    if (!customer) throw new ApiError(404, "Client introuvable");
    if (data.sessionId && data.method !== "CASH") throw new ApiError(400, "Seules les espèces entrent dans le tiroir-caisse");

    const amount = new Prisma.Decimal(data.amount);
    const payment = await prisma.$transaction(async (tx) => {
      let cashMovementId: string | undefined;
      let centerId: string | undefined;
      if (data.sessionId) {
        const mv = await recordDrawerMovement(tx, {
          companyId,
          sessionId: data.sessionId,
          userId: user.id,
          allowedCenterIds: user.role === "COMPANY_OWNER" ? null : user.centerIds,
          type: "CASH_IN",
          amount,
          reason: `Règlement client ${customer.name}`,
          allowOtherCashier: hasPermission(user.role, "cash:close_session_validate"),
        });
        cashMovementId = mv.id;
        centerId = mv.centerId;
      }

      // Fiche client verrouillée (après la caisse : même ordre de verrous que les ventes)
      // → deux règlements simultanés ne peuvent pas dépasser la dette
      await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${customerId} FOR UPDATE`;
      const balance = (await customerBalances(tx, companyId, [customerId])).get(customerId)?.balance ?? new Prisma.Decimal(0);
      if (amount.gt(balance)) {
        throw new ApiError(400, `Le client ne doit que ${balance.toString()}`, "OVERPAYMENT");
      }

      const created = await tx.customerPayment.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          companyId,
          customerId,
          amount,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          sessionId: data.sessionId,
          cashMovementId,
          receivedById: user.id,
        },
      });

      await writeAuditLog(
        {
          eventType: "CUSTOMER_PAYMENT_RECEIVED",
          companyId,
          centerId,
          userId: user.id,
          referenceType: "CustomerPayment",
          referenceId: created.id,
          result: "SUCCESS",
          oldValues: { balance: balance.toString() },
          newValues: { customerId, amount: amount.toString(), method: data.method, balance: balance.sub(amount).toString() },
          sessionId: data.sessionId,
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return created;
    });

    return NextResponse.json({ success: true, data: payment }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error) && idempotencyKey) {
      const existing = await prisma.customerPayment.findUnique({ where: { idempotencyKey } });
      if (existing) return NextResponse.json({ success: true, data: existing, replayed: true });
    }
    return handleApiError(error, "CUSTOMER_PAYMENTS");
  }
}
