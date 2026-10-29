import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { cancellationDecisionSchema, cancellationRequestSchema } from "@/lib/validations";
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
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

/** Charge la vente en vérifiant qu'elle est visible par l'utilisateur. */
async function loadSale(user: AuthUser, saleId: string) {
  const companyId = requireCompany(user);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId },
    include: { lines: true, payments: true },
  });
  if (!sale) throw new ApiError(404, "Vente introuvable");
  await requireCenterAccess(user, sale.centerId);
  return sale;
}

// ─────────────────────────────────────────────
// POST /api/sales/[id]/cancel (cahier §10)
//   { action: "request", reason }                           → demande (caissier)
//   { action: "decide", cancellationId, decision, rejectionReason? } → décision (gérant / propriétaire)
// L'identité du demandeur et de l'approbateur vient de la session.
// La vente d'origine n'est jamais supprimée : l'annulation est une
// opération distincte liée à la vente, avec remboursement et retour de stock.
// ─────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    const { id: saleId } = await params;
    const body = await readJson(req);

    if (body.action === "request") {
      await requirePermission(user, "sale:cancel_request");
      const { requestReason } = parseBody(cancellationRequestSchema, {
        saleId,
        requestReason: body.reason ?? body.requestReason,
      });
      const sale = await loadSale(user, saleId);

      if (sale.status !== "COMPLETED") {
        throw new ApiError(409, "Seule une vente finalisée peut faire l'objet d'une annulation", "INVALID_STATUS");
      }
      // Un caissier ne peut demander l'annulation que de ses propres ventes
      if (!hasPermission(user.role, "sale:view_all") && sale.cashierId !== user.id) {
        throw new ApiError(403, "Vous ne pouvez demander l'annulation que de vos propres ventes", "FORBIDDEN");
      }

      const cancellation = await prisma.$transaction(async (tx) => {
        // Verrou sur la vente : empêche deux demandes simultanées
        await tx.$executeRaw`SELECT 1 FROM "sales" WHERE "id" = ${saleId} FOR UPDATE`;
        const pending = await tx.cancellation.findFirst({ where: { saleId, status: "PENDING" } });
        if (pending) {
          throw new ApiError(409, "Une demande d'annulation est déjà en attente pour cette vente", "ALREADY_PENDING");
        }
        const created = await tx.cancellation.create({
          data: { saleId, requesterId: user.id, requestReason, status: "PENDING" },
        });
        await writeAuditLog(
          {
            eventType: "CANCELLATION_REQUESTED",
            companyId: sale.companyId,
            centerId: sale.centerId,
            userId: user.id,
            referenceType: "Sale",
            referenceId: saleId,
            result: "SUCCESS",
            reason: requestReason,
            newValues: { cancellationId: created.id },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
        return created;
      });

      return NextResponse.json({ success: true, data: cancellation }, { status: 201 });
    }

    if (body.action === "decide") {
      await requirePermission(user, "sale:cancel_approve");
      const { cancellationId, decision, rejectionReason } = parseBody(cancellationDecisionSchema, body);
      const sale = await loadSale(user, saleId);

      const cancellation = await prisma.cancellation.findFirst({
        where: { id: cancellationId, saleId },
      });
      if (!cancellation) throw new ApiError(404, "Demande d'annulation introuvable");
      if (cancellation.status !== "PENDING") {
        throw new ApiError(409, "Cette demande a déjà été traitée", "ALREADY_DECIDED");
      }
      // Séparation des tâches : personne n'approuve sa propre demande (cahier §10.2)
      if (cancellation.requesterId === user.id) {
        await writeAuditLog({
          eventType: "UNAUTHORIZED_ACCESS_ATTEMPT",
          companyId: sale.companyId,
          centerId: sale.centerId,
          userId: user.id,
          referenceType: "Cancellation",
          referenceId: cancellationId,
          result: "DENIED",
          reason: "Tentative d'auto-approbation d'une annulation",
        });
        throw new ApiError(403, "Vous ne pouvez pas décider de votre propre demande", "SELF_APPROVAL");
      }

      if (decision === "REJECTED") {
        if (!rejectionReason || rejectionReason.trim().length < 3) {
          throw new ApiError(400, "Motif de refus requis");
        }
        await prisma.$transaction(async (tx) => {
          const updated = await tx.cancellation.updateMany({
            where: { id: cancellationId, status: "PENDING" },
            data: { status: "REJECTED", approverId: user.id, rejectionReason, decidedAt: new Date() },
          });
          if (updated.count === 0) throw new ApiError(409, "Cette demande a déjà été traitée", "ALREADY_DECIDED");
          await writeAuditLog(
            {
              eventType: "CANCELLATION_REJECTED",
              companyId: sale.companyId,
              centerId: sale.centerId,
              userId: user.id,
              referenceType: "Sale",
              referenceId: saleId,
              result: "SUCCESS",
              reason: rejectionReason,
              newValues: { cancellationId },
              ipAddress: user.ipAddress,
              userAgent: user.userAgent,
            },
            tx
          );
        });
        return NextResponse.json({ success: true, message: "Demande rejetée." });
      }

      // APPROVED : retour de stock + remboursement + statut, en une transaction
      await prisma.$transaction(async (tx) => {
        // Changements conditionnels : protègent contre deux approbations simultanées
        const decided = await tx.cancellation.updateMany({
          where: { id: cancellationId, status: "PENDING" },
          data: { status: "APPROVED", approverId: user.id, decidedAt: new Date() },
        });
        if (decided.count === 0) throw new ApiError(409, "Cette demande a déjà été traitée", "ALREADY_DECIDED");

        const saleUpdated = await tx.sale.updateMany({
          where: { id: saleId, status: "COMPLETED" },
          data: { status: "CANCELLED" },
        });
        if (saleUpdated.count === 0) throw new ApiError(409, "La vente n'est plus annulable", "INVALID_STATUS");

        // Retour en stock, dans l'unité de base (celle des mouvements de vente)
        const saleMovements = await tx.stockMovement.findMany({
          where: { referenceType: "Sale", referenceId: saleId, type: "SALE" },
        });
        const stockImpact: Array<{ stockId: string; quantity: string }> = [];
        for (const mv of saleMovements) {
          const qty = mv.quantity.negated(); // la sortie était négative
          await tx.stock.update({
            where: { id: mv.stockId },
            data: { quantity: { increment: qty }, version: { increment: 1 } },
          });
          await tx.stockMovement.create({
            data: {
              stockId: mv.stockId,
              type: "CUSTOMER_RETURN",
              quantity: qty,
              unitId: mv.unitId,
              referenceType: "Cancellation",
              referenceId: cancellationId,
              notes: `Annulation de la vente ${sale.saleNumber}`,
              performedById: user.id,
              centerId: sale.centerId,
            },
          });
          stockImpact.push({ stockId: mv.stockId, quantity: qty.toString() });
        }

        // Remboursement : une opération par moyen de paiement d'origine
        let cashImpact = 0;
        for (const p of sale.payments) {
          await tx.refund.create({
            data: {
              saleId,
              amount: p.amount,
              method: p.method,
              reason: `Annulation : ${cancellation.requestReason}`,
              approvedById: user.id,
              performedById: user.id,
            },
          });
          cashImpact += Number(p.amount);
        }

        await tx.cancellation.update({
          where: { id: cancellationId },
          data: { stockImpact, cashImpact },
        });

        await writeAuditLog(
          {
            eventType: "CANCELLATION_APPROVED",
            companyId: sale.companyId,
            centerId: sale.centerId,
            userId: user.id,
            referenceType: "Sale",
            referenceId: saleId,
            result: "SUCCESS",
            oldValues: { status: "COMPLETED" },
            newValues: { status: "CANCELLED", cancellationId, refunded: cashImpact, stockImpact },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
      });

      return NextResponse.json({ success: true, message: "Annulation approuvée. Stock restauré et remboursement enregistré." });
    }

    throw new ApiError(400, "Action invalide");
  } catch (error) {
    return handleApiError(error, "SALES/CANCEL");
  }
}

// GET /api/sales/[id]/cancel — Historique des demandes d'annulation d'une vente
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:view");
    const { id: saleId } = await params;
    const sale = await loadSale(user, saleId);
    if (!hasPermission(user.role, "sale:view_all") && sale.cashierId !== user.id) {
      throw new ApiError(404, "Vente introuvable");
    }

    const cancellations = await prisma.cancellation.findMany({
      where: { saleId },
      include: {
        requester: { select: { firstName: true, lastName: true } },
        approver: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: cancellations });
  } catch (error) {
    return handleApiError(error, "SALES/CANCEL");
  }
}
