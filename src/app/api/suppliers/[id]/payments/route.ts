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
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import { allocateSupplierPayment, recordDrawerMovement } from "@/lib/finance";

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Montant invalide"),
  method: z.enum(["CASH", "MOBILE_MONEY", "CARD", "TRANSFER"]),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(300).optional(),
  /** Facture à régler (sinon : la plus ancienne échéance d'abord). */
  purchaseId: z.string().optional(),
  /** Espèces prises dans une caisse ouverte (sinon : coffre, banque…). */
  sessionId: z.string().optional(),
});

// POST /api/suppliers/[id]/payments — Payer un fournisseur
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "supplier:payment");
    const companyId = requireCompany(user);
    const { id: supplierId } = await params;
    const data = parseBody(paymentSchema, await readJson(req));

    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId }, select: { id: true, name: true } });
    if (!supplier) throw new ApiError(404, "Fournisseur introuvable");
    if (data.sessionId && data.method !== "CASH") throw new ApiError(400, "Seules les espèces sortent du tiroir-caisse");

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
          type: "CASH_OUT",
          amount,
          reason: `Paiement fournisseur ${supplier.name}`,
          allowOtherCashier: true, // le payeur a le droit « supplier:payment » (responsable)
        });
        cashMovementId = mv.id;
        centerId = mv.centerId;
      }

      const allocations = await allocateSupplierPayment(tx, { companyId, supplierId, amount, purchaseId: data.purchaseId });

      const created = await tx.supplierPayment.create({
        data: {
          companyId,
          supplierId,
          purchaseId: data.purchaseId,
          amount,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          sessionId: data.sessionId,
          cashMovementId,
          allocations,
          paidById: user.id,
        },
      });

      await writeAuditLog(
        {
          eventType: "SUPPLIER_PAYMENT_MADE",
          companyId,
          centerId,
          userId: user.id,
          referenceType: "SupplierPayment",
          referenceId: created.id,
          result: "SUCCESS",
          newValues: { supplierId, amount: amount.toString(), method: data.method, allocations },
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
    return handleApiError(error, "SUPPLIER_PAYMENTS");
  }
}
