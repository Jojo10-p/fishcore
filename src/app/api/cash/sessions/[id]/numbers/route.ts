import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";
import { MAX_AHEAD, allocateBlock, sessionBlocks } from "@/lib/invoice-numbers";

// ─────────────────────────────────────────────
// Numérotation et en-tête de ticket d'une session de caisse
// ─────────────────────────────────────────────
// GET  : plages de numéros de la session, numéros déjà enregistrés par le
//        serveur, et l'en-tête des tickets (entreprise, magasin, IFU…) que la
//        caisse garde sur l'appareil pour imprimer même sans connexion.
// POST : nouvelle plage (la caisse en demande une avant d'arriver au bout).

type Params = { params: Promise<{ id: string }> };

async function loadOwnSession(req: NextRequest, params: Params["params"]) {
  const user = await getCurrentUser(req);
  await requirePermission(user, "sale:create");
  const companyId = requireCompany(user);
  const { id } = await params;
  const session = await prisma.cashSession.findFirst({
    where: { id, cashRegister: { center: { companyId } } },
    select: {
      id: true,
      cashierId: true,
      closedAt: true,
      cashier: { select: { firstName: true, lastName: true } },
      cashRegister: { select: { name: true, center: { select: { id: true, name: true, address: true, city: true, phone: true } } } },
    },
  });
  if (!session) throw new ApiError(404, "Session de caisse introuvable");
  if (session.cashierId !== user.id) throw new ApiError(403, "Cette session appartient à un autre caissier", "SESSION_NOT_OWNED");
  return { user, companyId, session };
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { companyId, session } = await loadOwnSession(req, params);
    const [blocks, used, company] = await Promise.all([
      sessionBlocks(prisma, session.id),
      prisma.sale.findMany({ where: { sessionId: session.id, invoiceSeq: { not: null } }, select: { invoiceSeq: true } }),
      prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: {
          tradeName: true,
          legalName: true,
          phone: true,
          address: true,
          city: true,
          taxId: true,
          tradeRegNumber: true,
          currency: true,
          invoiceNotes: true,
          requiresPickup: true,
          emecfEnabled: true,
          invoiceFormat: true,
        },
      }),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        closed: !!session.closedAt,
        blocks,
        used: used.map((s) => s.invoiceSeq!),
        header: {
          company,
          center: session.cashRegister.center,
          registerName: session.cashRegister.name,
          cashierFirstName: session.cashier.firstName,
        },
      },
    });
  } catch (error) {
    return handleApiError(error, "CASH");
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { companyId, session } = await loadOwnSession(req, params);
    if (session.closedAt) throw new ApiError(409, "La session de caisse est clôturée", "SESSION_CLOSED");
    const block = await prisma.$transaction(async (tx) => {
      // Session verrouillée : une clôture simultanée ne peut pas laisser une plage orpheline
      const open = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "cash_sessions" WHERE "id" = ${session.id} AND "closedAt" IS NULL FOR UPDATE`;
      if (open.length === 0) throw new ApiError(409, "La session de caisse est clôturée", "SESSION_CLOSED");
      // Pas d'accumulation : une caisse ne garde qu'une avance raisonnable
      const current = await sessionBlocks(tx, session.id);
      const capacity = current.reduce((s, b) => s + b.last - b.first + 1, 0);
      const used = await tx.sale.count({ where: { sessionId: session.id, invoiceSeq: { not: null } } });
      if (capacity - used >= MAX_AHEAD) return null;
      return allocateBlock(tx, { companyId, sessionId: session.id });
    });
    return NextResponse.json({ success: true, data: { block, blocks: await sessionBlocks(prisma, session.id) } }, { status: block ? 201 : 200 });
  } catch (error) {
    return handleApiError(error, "CASH");
  }
}
