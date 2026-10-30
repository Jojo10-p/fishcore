import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApiError } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform";
import { createResetLink, publicOrigin } from "@/lib/password-reset";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/platform/companies/[id]/reset-link — Lien de mot de passe pour le
// propriétaire (après vérification de son identité par l'assistance)
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const admin = await requirePlatformAdmin(req);
    const { id } = await params;
    const owner = await prisma.user.findFirst({ where: { companyId: id, role: "COMPANY_OWNER", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, firstName: true, lastName: true, phone: true, email: true } });
    if (!owner) throw new ApiError(404, "Aucun propriétaire actif pour cette entreprise");
    const link = await createResetLink(owner.id, admin.id, publicOrigin(req.nextUrl.origin));
    return NextResponse.json({ success: true, data: { ...link, owner } }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}
