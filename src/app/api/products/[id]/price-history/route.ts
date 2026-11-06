import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";

type Values = { sellingPrice?: string; purchasePrice?: string; prices?: Record<string, string> } | null;

// GET /api/products/[id]/price-history — Tous les changements de prix d'un article :
// quand, qui, ancien et nouveau prix (unité, carton, lot), motif.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "audit:view");
    const companyId = requireCompany(user);
    const { id } = await params;
    const product = await prisma.product.findFirst({ where: { id, companyId }, select: { id: true, name: true } });
    if (!product) throw new ApiError(404, "Produit introuvable");

    const logs = await prisma.auditLog.findMany({
      where: { companyId, eventType: "PRICE_CHANGED", referenceType: "Product", referenceId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, createdAt: true, reason: true, oldValues: true, newValues: true, user: { select: { firstName: true, lastName: true, role: true } } },
    });

    const prices = (v: Values) => v?.prices ?? (v?.sellingPrice !== undefined ? { unité: v.sellingPrice } : {});
    const data = logs.map((l) => {
      const o = l.oldValues as Values;
      const n = l.newValues as Values;
      const before = prices(o);
      const after = prices(n);
      const changes = Object.keys({ ...before, ...after })
        .filter((k) => before[k] !== after[k])
        .map((k) => ({ label: k, before: before[k] ?? null, after: after[k] ?? null }));
      if (o?.purchasePrice !== undefined && n?.purchasePrice !== undefined && Number(o.purchasePrice) !== Number(n.purchasePrice)) {
        changes.push({ label: "prix d'achat", before: o.purchasePrice, after: n.purchasePrice });
      }
      return {
        id: l.id,
        at: l.createdAt,
        by: l.user ? `${l.user.firstName} ${l.user.lastName}`.trim() : null,
        role: l.user?.role ?? null,
        reason: l.reason,
        changes,
      };
    });
    return NextResponse.json({ success: true, data: { product, history: data } });
  } catch (error) {
    return handleApiError(error, "PRODUCTS");
  }
}
