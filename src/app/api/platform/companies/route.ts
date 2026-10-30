import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/auth";
import { companyActivity, companyListSelect, requirePlatformAdmin, withAccess } from "@/lib/platform";

// GET /api/platform/companies?q=&status= — Toutes les entreprises clientes
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const status = req.nextUrl.searchParams.get("status");
    const where: Prisma.CompanyWhereInput = q
      ? {
          OR: [
            { tradeName: { contains: q, mode: "insensitive" } },
            { ownerName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { taxId: q },
          ],
        }
      : {};
    const companies = await prisma.company.findMany({ where, select: companyListSelect, orderBy: { createdAt: "desc" }, take: 500 });
    const activity = await companyActivity(companies.map((c) => c.id));
    const rows = companies.map((c) => ({ ...withAccess(c), activity: activity.get(c.id)! })).filter((c) => !status || c.status === status);
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}
