import { NextRequest, NextResponse } from "next/server";
import { AuditEventType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";
import { dayBounds, ISO_DATE } from "@/lib/time";

const EVENT_TYPES = new Set(Object.values(AuditEventType));

// GET /api/audit — Journal d'audit de l'entreprise (lecture seule, le plus récent d'abord)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD&eventType=&userId=&centerId=&result=&q=&cursor=<id>
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "audit:view");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;

    const where: Prisma.AuditLogWhereInput = { companyId };
    // Journées au fuseau de l'entreprise
    const from = sp.get("from");
    const to = sp.get("to");
    if ((from && ISO_DATE.test(from)) || (to && ISO_DATE.test(to))) {
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
      const tz = company?.timezone ?? "Africa/Porto-Novo";
      where.serverTimestamp = {
        ...(from && ISO_DATE.test(from) ? { gte: dayBounds(from, tz).start } : {}),
        ...(to && ISO_DATE.test(to) ? { lte: dayBounds(to, tz).end } : {}),
      };
    }
    const types = (sp.get("eventType") ?? "").split(",").filter((t) => EVENT_TYPES.has(t as AuditEventType)) as AuditEventType[];
    if (types.length) where.eventType = { in: types };
    if (sp.get("userId")) where.userId = sp.get("userId")!;
    if (sp.get("centerId")) where.centerId = sp.get("centerId")!;
    const result = sp.get("result");
    if (result === "SUCCESS" || result === "FAILED" || result === "DENIED") where.result = result;
    const q = sp.get("q")?.trim();
    if (q) where.OR = [{ reason: { contains: q, mode: "insensitive" } }, { referenceId: q }, { ipAddress: q }];

    const take = 100;
    const cursor = sp.get("cursor");
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ serverTimestamp: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        serverTimestamp: true,
        deviceTimestamp: true,
        eventType: true,
        result: true,
        reason: true,
        referenceType: true,
        referenceId: true,
        oldValues: true,
        newValues: true,
        ipAddress: true,
        userAgent: true,
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
        center: { select: { id: true, name: true, code: true } },
      },
    });
    const hasMore = rows.length > take;
    const data = hasMore ? rows.slice(0, take) : rows;

    const users = await prisma.user.findMany({ where: { companyId }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } });
    return NextResponse.json({ success: true, data, nextCursor: hasMore ? data[data.length - 1].id : null, users });
  } catch (error) {
    return handleApiError(error, "AUDIT");
  }
}
