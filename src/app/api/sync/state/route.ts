import { NextRequest, NextResponse } from "next/server";
import { runAfter } from "@/lib/background";
import { sweepIfDue } from "@/lib/emecf/normalize";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCenterAccess, requireCompany, requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────
// GET /api/sync/state?centerId=… — Empreinte du stock et du catalogue
// ─────────────────────────────────────────────
// Interrogée toutes les quelques secondes par les caisses : quelques octets,
// une seule requête indexée. Quand l'empreinte change (réception validée,
// vente d'une autre caisse, prix modifié, ajustement…), la caisse recharge
// son stock et son catalogue. Elle reste ainsi à jour sans action, et prête
// à continuer seule si la connexion tombe.
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:view");
    const companyId = requireCompany(user);
    const centerId = req.nextUrl.searchParams.get("centerId");
    if (centerId) await requireCenterAccess(user, centerId);

    // Deux empreintes : le stock (change à chaque vente) et le catalogue
    // (prix, articles, conditionnements, unités) — la caisse ne recharge que ce qui a changé
    const [row] = await prisma.$queryRaw<{ stock: string; catalog: string }[]>`
      SELECT
        md5(coalesce((SELECT concat(max("updatedAt"), ':', count(*), ':', sum("quantity"), ':', sum("reservedQty"))
                        FROM "stocks" WHERE "centerId" = ${centerId ?? ""}), '')) AS stock,
        md5(concat_ws('|',
          (SELECT concat(max("updatedAt"), ':', count(*)) FROM "products" WHERE "companyId" = ${companyId}),
          (SELECT concat(count(*), ':', sum(uc."factor"), ':', sum(coalesce(uc."sellingPrice", 0)), ':', count(uc."barcode"), ':', max(p."updatedAt"))
             FROM "unit_conversions" uc JOIN "products" p ON p."id" = uc."productId" WHERE p."companyId" = ${companyId}),
          (SELECT count(*) FILTER (WHERE "allowsDecimal") FROM "units" WHERE "companyId" = ${companyId})
        )) AS catalog`;

    // Factures en attente de normalisation : reprises dès que le réseau revient
    runAfter(() => sweepIfDue(companyId));

    return NextResponse.json(
      { success: true, data: { stock: row.stock, catalog: row.catalog, stamp: `${row.stock}.${row.catalog}` } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleApiError(error, "SYNC");
  }
}
