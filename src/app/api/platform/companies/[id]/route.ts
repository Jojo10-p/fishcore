import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, handleApiError, parseBody, readJson } from "@/lib/auth";
import { companyActivity, isInactive, requirePlatformAdmin } from "@/lib/platform";

type Ctx = { params: Promise<{ id: string }> };

async function detail(id: string) {
  const c = await prisma.company.findUnique({
    where: { id },
    select: {
      id: true,
      tradeName: true,
      legalName: true,
      ownerName: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      taxId: true,
      tradeRegNumber: true,
      businessType: true,
      currency: true,
      logoUrl: true,
      createdAt: true,
      isActive: true,
      suspendedAt: true,
      suspendedReason: true,
      platformNotes: true,
      centers: { select: { id: true, name: true, code: true, status: true, city: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      users: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, centers: { where: { isActive: true }, select: { centerId: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { products: true, customers: true, suppliers: true } },
    },
  });
  if (!c) throw new ApiError(404, "Entreprise introuvable");
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const centerIds = c.centers.map((x) => x.id);
  const [activity, byCenter, openSessions, stockByCenter, daily] = await Promise.all([
    companyActivity([id]),
    prisma.sale.groupBy({ by: ["centerId"], where: { companyId: id, createdAt: { gte: since30 }, status: { not: "CANCELLED" } }, _count: true, _sum: { totalAmount: true }, _max: { createdAt: true } }),
    prisma.cashSession.groupBy({ by: ["cashRegisterId"], where: { closedAt: null, cashRegister: { centerId: { in: centerIds } } }, _count: true }),
    prisma.$queryRaw<Array<{ centerId: string; articles: bigint; value: number | null }>>`
      SELECT "centerId", COUNT(*) FILTER (WHERE "quantity" > 0) AS articles, SUM("quantity" * "avgCost")::float AS value
        FROM "stocks" WHERE "centerId" = ANY(${centerIds}) GROUP BY "centerId"`,
    prisma.$queryRaw<Array<{ day: string; n: bigint; amount: number }>>`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, COUNT(*) AS n, SUM("totalAmount")::float AS amount
        FROM "sales" WHERE "companyId" = ${id} AND "createdAt" >= ${since30} AND "status" <> 'CANCELLED' GROUP BY 1 ORDER BY 1`,
  ]);
  const registers = await prisma.cashRegister.findMany({ where: { centerId: { in: centerIds } }, select: { id: true, centerId: true } });
  const centers = c.centers.map((center) => {
    const s = byCenter.find((x) => x.centerId === center.id);
    const st = stockByCenter.find((x) => x.centerId === center.id);
    const regs = registers.filter((r) => r.centerId === center.id).map((r) => r.id);
    return {
      ...center,
      sales30d: s?._count ?? 0,
      revenue30d: Number(s?._sum.totalAmount ?? 0),
      lastSaleAt: s?._max.createdAt ?? null,
      registers: regs.length,
      openSessions: openSessions.filter((o) => regs.includes(o.cashRegisterId)).reduce((n, o) => n + o._count, 0),
      users: c.users.filter((u) => u.isActive && (u.role === "COMPANY_OWNER" || u.centers.some((x) => x.centerId === center.id))).length,
      stockArticles: Number(st?.articles ?? 0),
      stockValue: Math.round(st?.value ?? 0),
    };
  });
  // 30 derniers jours, jours sans vente compris
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    const row = daily.find((x) => x.day === d);
    return { day: d, count: Number(row?.n ?? 0), amount: Math.round(row?.amount ?? 0) };
  });
  const act = activity.get(id)!;
  return { ...c, centers, activity: act, inactive: c.isActive && isInactive(act), daily: days };
}

// GET /api/platform/companies/[id] — Fiche d'une entreprise
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    await requirePlatformAdmin(req);
    const { id } = await params;
    return NextResponse.json({ success: true, data: await detail(id) });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}

const patchSchema = z.object({
  platformNotes: z.string().max(2000).nullable().optional(),
  /** Suspendre (motif obligatoire, visible par le client) ou réactiver. */
  suspend: z.object({ reason: z.string().trim().min(3, "Motif obligatoire") }).optional(),
  reactivate: z.literal(true).optional(),
});

// PATCH /api/platform/companies/[id] — Notes internes, suspension / réactivation
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const admin = await requirePlatformAdmin(req);
    const { id } = await params;
    const data = parseBody(patchSchema, await readJson(req));
    const before = await prisma.company.findUnique({ where: { id }, select: { isActive: true } });
    if (!before) throw new ApiError(404, "Entreprise introuvable");

    await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id },
        data: {
          ...(data.platformNotes !== undefined ? { platformNotes: data.platformNotes } : {}),
          ...(data.suspend ? { isActive: false, suspendedAt: new Date(), suspendedReason: data.suspend.reason } : {}),
          ...(data.reactivate ? { isActive: true, suspendedAt: null, suspendedReason: null } : {}),
        },
      });
      if (data.suspend || data.reactivate) {
        // Suspension : tous les utilisateurs sont déconnectés aussitôt
        if (data.suspend) await tx.authSession.deleteMany({ where: { user: { companyId: id } } });
        await writeAuditLog(
          {
            eventType: data.suspend ? "COMPANY_SUSPENDED" : "COMPANY_REACTIVATED",
            companyId: id,
            userId: admin.id,
            referenceType: "Company",
            referenceId: id,
            result: "SUCCESS",
            reason: data.suspend?.reason,
            oldValues: { isActive: before.isActive },
            newValues: { isActive: !data.suspend, by: "créateur de la plateforme" },
            ipAddress: admin.ipAddress,
            userAgent: admin.userAgent,
          },
          tx
        );
      }
    });
    return NextResponse.json({ success: true, data: await detail(id) });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}
