import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import { computeFinance, financeToCsv } from "@/lib/reports";
import { ISO_DATE, periodBounds, previousPeriod, todayIn } from "@/lib/time";

// GET /api/reports/finance?from=AAAA-MM-JJ&to=AAAA-MM-JJ&centerId=…&compare=true&format=csv
// Rapport financier de la période (dates incluses, fuseau de l'entreprise).
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "report:view");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true, tradeName: true } });
    const tz = company.timezone || "Africa/Porto-Novo";
    const today = todayIn(tz);
    const from = sp.get("from") ?? today;
    const to = sp.get("to") ?? today;
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) throw new ApiError(400, "Période invalide");

    // Centres couverts : celui demandé, sinon tous les centres visibles de l'utilisateur
    const centerId = sp.get("centerId");
    let centerIds: string[] | null;
    if (centerId) {
      await requireCenterAccess(user, centerId);
      centerIds = [centerId];
    } else {
      centerIds = user.role === "COMPANY_OWNER" ? null : user.centerIds;
    }

    const current = await computeFinance({ companyId, centerIds, timeZone: tz, ...periodBounds(from, to, tz) });

    if (sp.get("format") === "csv") {
      await requirePermission(user, "report:export");
      const label = `${company.tradeName} — du ${from} au ${to}`;
      // Exportation sensible : historisée (cahier §17.1)
      await writeAuditLog({
        eventType: "DOCUMENT_EXPORTED",
        companyId,
        userId: user.id,
        referenceType: "FinanceReport",
        result: "SUCCESS",
        newValues: { from, to, centerId: centerId ?? null, format: "csv" },
        ipAddress: user.ipAddress,
        userAgent: user.userAgent,
      });
      return new NextResponse(financeToCsv(current, label), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="rapport-financier-${from}-${to}.csv"`,
        },
      });
    }

    let previous = null;
    if (sp.get("compare") === "true") {
      const prev = previousPeriod(from, to);
      previous = { ...prev, report: await computeFinance({ companyId, centerIds, timeZone: tz, ...periodBounds(prev.from, prev.to, tz) }) };
    }

    return NextResponse.json({ success: true, data: { from, to, current, previous } });
  } catch (error) {
    return handleApiError(error, "REPORTS/FINANCE");
  }
}
