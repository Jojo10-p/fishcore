import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
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
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { setSessionReservation } from "@/lib/stock";

// ─────────────────────────────────────────────
// Réserves de stock par session de caisse (cahier §9.4)
// ─────────────────────────────────────────────
// Avant une coupure prévisible (ou dès l'ouverture), une caisse réserve les
// quantités qu'elle pourra vendre hors connexion. Hors ligne, la caisse ne
// vend que dans la limite de SA réserve : deux caisses ne peuvent jamais
// vendre le même poisson.

const reserveSchema = z.object({
  sessionId: z.string().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().min(0, "Quantité invalide"), // valeur cible absolue
      })
    )
    .min(1, "Au moins un produit"),
});

async function loadOpenSession(user: AuthUser, sessionId: string) {
  const companyId = requireCompany(user);
  const session = await prisma.cashSession.findFirst({
    where: { id: sessionId, cashRegister: { center: { companyId } } },
    select: { id: true, cashierId: true, closedAt: true, cashRegister: { select: { centerId: true } } },
  });
  if (!session) throw new ApiError(404, "Session introuvable");
  await requireCenterAccess(user, session.cashRegister.centerId);
  // Le caissier gère la réserve de sa session ; un responsable peut gérer celles de son centre
  if (session.cashierId !== user.id && !hasPermission(user.role, "cash:close_session_validate")) {
    throw new ApiError(403, "Cette session appartient à un autre caissier", "SESSION_NOT_OWNED");
  }
  return session;
}

// GET /api/stock/reservations?sessionId=xxx — Réserves de la session
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:create");
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    if (!sessionId) throw new ApiError(400, "sessionId requis");
    await loadOpenSession(user, sessionId);

    const reservations = await prisma.stockReservation.findMany({
      where: { sessionId },
      select: { quantity: true, updatedAt: true, stock: { select: { productId: true, centerId: true } } },
    });

    return NextResponse.json({
      success: true,
      data: reservations.map((r) => ({
        productId: r.stock.productId,
        centerId: r.stock.centerId,
        quantity: Number(r.quantity),
        updatedAt: r.updatedAt,
      })),
    });
  } catch (error) {
    return handleApiError(error, "RESERVATIONS");
  }
}

// POST /api/stock/reservations — Fixe les réserves de la session (valeurs absolues ; 0 = libérer)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const { sessionId, items } = parseBody(reserveSchema, await readJson(req));
    const session = await loadOpenSession(user, sessionId);
    if (session.closedAt) throw new ApiError(409, "Session clôturée", "SESSION_CLOSED");
    const centerId = session.cashRegister.centerId;

    // Un même produit une seule fois ; ordre fixe pour les verrous
    const targets = new Map<string, number>();
    for (const it of items) targets.set(it.productId, it.quantity);
    const productIds = [...targets.keys()].sort();

    const stocks = await prisma.stock.findMany({
      where: { centerId, productId: { in: productIds }, product: { companyId } },
      select: { id: true, productId: true, product: { select: { name: true } } },
    });
    if (stocks.length !== productIds.length) throw new ApiError(400, "Produit sans stock dans ce centre");
    const byProduct = new Map(stocks.map((s) => [s.productId, s]));

    const result = await prisma.$transaction(async (tx) => {
      // Fige la session : pas de clôture pendant la réservation
      const open = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "cash_sessions" WHERE "id" = ${sessionId} AND "closedAt" IS NULL FOR UPDATE`;
      if (open.length === 0) throw new ApiError(409, "Session clôturée", "SESSION_CLOSED");

      const changes: Array<{ productId: string; previous: string; current: string }> = [];
      for (const productId of productIds) {
        const stock = byProduct.get(productId)!;
        const { previous, current } = await setSessionReservation(tx, {
          sessionId,
          stockId: stock.id,
          target: new Prisma.Decimal(targets.get(productId)!),
          productName: stock.product.name,
        });
        if (!previous.equals(current)) {
          changes.push({ productId, previous: previous.toString(), current: current.toString() });
        }
      }

      if (changes.length > 0) {
        await writeAuditLog(
          {
            eventType: "STOCK_RESERVED",
            companyId,
            centerId,
            userId: user.id,
            referenceType: "CashSession",
            referenceId: sessionId,
            result: "SUCCESS",
            newValues: { changes },
            sessionId,
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
      }
      return changes;
    });

    return NextResponse.json({ success: true, data: { changes: result } });
  } catch (error) {
    return handleApiError(error, "RESERVATIONS");
  }
}
