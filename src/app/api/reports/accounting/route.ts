import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, requireCenterAccess, requireCompany } from "@/lib/auth";
import { accountingToCsv, computeAccounting } from "@/lib/accounting";
import { ISO_DATE, periodBounds, todayIn } from "@/lib/time";

// GET /api/reports/accounting?from=AAAA-MM-JJ&to=AAAA-MM-JJ&centerId=…&format=csv
// Comptabilité de la période : journal, balance, résultat, trésorerie, situation (direction seulement).
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (user.role !== "COMPANY_OWNER") throw new ApiError(403, "La comptabilité est réservée à la direction", "FORBIDDEN");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true, tradeName: true, vatEnabled: true, taxId: true } });
    const tz = company.timezone || "Africa/Porto-Novo";
    const today = todayIn(tz);
    const from = sp.get("from") ?? `${today.slice(0, 7)}-01`;
    const to = sp.get("to") ?? today;
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) throw new ApiError(400, "Période invalide");
    const centerId = sp.get("centerId");
    if (centerId) await requireCenterAccess(user, centerId);

    const data = await computeAccounting({ companyId, centerIds: centerId ? [centerId] : null, timeZone: tz, ...periodBounds(from, to, tz) });

    if (sp.get("format") === "csv") {
      await writeAuditLog({
        eventType: "DOCUMENT_EXPORTED",
        companyId,
        userId: user.id,
        referenceType: "AccountingReport",
        result: "SUCCESS",
        newValues: { from, to, centerId: centerId ?? null, format: "csv" },
        ipAddress: user.ipAddress,
        userAgent: user.userAgent,
      });
      return new NextResponse(accountingToCsv(data, `${company.tradeName} — du ${from} au ${to}`), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="comptabilite-${from}-${to}.csv"` },
      });
    }
    return NextResponse.json({ success: true, data: { from, to, company: { name: company.tradeName, vatEnabled: company.vatEnabled, ifu: company.taxId }, ...data } });
  } catch (error) {
    return handleApiError(error, "REPORTS/ACCOUNTING");
  }
}
