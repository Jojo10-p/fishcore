import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission, visibleCenterFilter } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";

const select = {
  id: true,
  createdAt: true,
  quantity: true,
  threshold: true,
  readAt: true,
  emailedAt: true,
  emailError: true,
  resolvedAt: true,
  center: { select: { id: true, name: true, code: true } },
  product: { select: { id: true, name: true, internalCode: true, baseUnit: { select: { symbol: true } }, category: { select: { name: true } } } },
} as const;

// GET /api/stock-alerts — alertes ouvertes, historique récent, nombre de non lues
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");
    const companyId = requireCompany(user);
    const centerId = visibleCenterFilter(user);
    const where = { companyId, ...(centerId ? { centerId } : {}) };
    const [open, resolved] = await Promise.all([
      prisma.stockAlert.findMany({ where: { ...where, resolvedAt: null }, select, orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }] }),
      prisma.stockAlert.findMany({ where: { ...where, resolvedAt: { not: null } }, select, orderBy: { resolvedAt: "desc" }, take: 30 }),
    ]);
    const isOwner = user.role === "COMPANY_OWNER";
    return NextResponse.json({
      success: true,
      data: { open, resolved, unread: open.filter((a) => !a.readAt).length, email: { configured: emailConfigured(), forOwner: isOwner } },
    });
  } catch (error) {
    return handleApiError(error, "STOCK_ALERTS");
  }
}

const patchSchema = z.object({ ids: z.array(z.string().min(1)).max(500).optional(), all: z.literal(true).optional() });

// PATCH /api/stock-alerts — marquer comme lues ({ ids } ou { all: true })
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");
    const companyId = requireCompany(user);
    const { ids, all } = parseBody(patchSchema, await readJson(req));
    const centerId = visibleCenterFilter(user);
    const r = await prisma.stockAlert.updateMany({
      where: { companyId, readAt: null, ...(centerId ? { centerId } : {}), ...(all ? {} : { id: { in: ids ?? [] } }) },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ success: true, data: { updated: r.count } });
  } catch (error) {
    return handleApiError(error, "STOCK_ALERTS");
  }
}
