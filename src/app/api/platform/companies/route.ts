import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/auth";
import { companyActivity, companyListSelect, isInactive, requirePlatformAdmin } from "@/lib/platform";
import { BUSINESS_PROFILES } from "@/lib/business-profiles";

// GET /api/platform/companies?q=&state=active|inactive|suspended|multi&type=&format=csv
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim();
    const state = sp.get("state");
    const type = sp.get("type");
    const where: Prisma.CompanyWhereInput = {
      ...(q
        ? {
            OR: [
              { tradeName: { contains: q, mode: "insensitive" } },
              { ownerName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { city: { contains: q, mode: "insensitive" } },
              { taxId: q },
            ],
          }
        : {}),
      ...(type ? { businessType: type as Prisma.EnumBusinessTypeFilter["equals"] } : {}),
      ...(state === "suspended" ? { isActive: false } : {}),
    };
    const companies = await prisma.company.findMany({ where, select: companyListSelect, orderBy: { createdAt: "desc" }, take: 1000 });
    const activity = await companyActivity(companies.map((c) => c.id));
    const rows = companies
      .map((c) => ({ ...c, activity: activity.get(c.id)!, inactive: c.isActive && isInactive(activity.get(c.id)) }))
      .filter((c) => (state === "inactive" ? c.inactive : state === "active" ? c.isActive && !c.inactive : state === "multi" ? c._count.centers > 1 : true));

    if (sp.get("format") === "csv") {
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
      const header = ["Entreprise", "Propriétaire", "E-mail", "Téléphone", "Ville", "Métier", "Inscrite le", "Centres", "Utilisateurs", "Articles", "Ventes 30 j", "CA 30 j", "Dernière activité", "Statut"];
      const lines = rows.map((r) =>
        [
          r.tradeName,
          r.ownerName,
          r.email,
          r.phone,
          r.city,
          BUSINESS_PROFILES[r.businessType]?.label ?? r.businessType,
          day(r.createdAt),
          r._count.centers,
          r._count.users,
          r._count.products,
          r.activity.sales30d,
          r.activity.revenue30d,
          day(r.activity.lastActivityAt),
          !r.isActive ? "Suspendue" : r.inactive ? "Inactive" : "Active",
        ]
          .map(esc)
          .join(";")
      );
      return new NextResponse("﻿" + [header.map(esc).join(";"), ...lines].join("\r\n"), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="entreprises-${new Date().toISOString().slice(0, 10)}.csv"` },
      });
    }
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}
