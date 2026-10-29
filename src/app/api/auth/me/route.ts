import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/secrets";
import { ApiError, getCurrentUser, handleApiError } from "@/lib/auth";
import { getPermissions } from "@/lib/rbac";

// GET /api/auth/me — Utilisateur courant, son entreprise, ses centres et ses permissions
export async function GET(req: NextRequest) {
  try {
    const auth = await getCurrentUser(req);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatarUrl: true,
        company: {
          select: { id: true, tradeName: true, logoUrl: true, currency: true, timezone: true },
        },
      },
    });

    const centers = await prisma.center.findMany({
      where: auth.role === "COMPANY_OWNER" ? { companyId: auth.companyId ?? "" } : { id: { in: auth.centerIds } },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          avatarUrl: user.avatarUrl,
        },
        company: user.company,
        centers,
        // Pour adapter l'interface au rôle (le serveur reste seul juge)
        permissions: getPermissions(auth.role),
      },
    });
  } catch (error) {
    const response = handleApiError(error, "AUTH/ME");
    if (error instanceof ApiError && error.status === 401) {
      response.cookies.delete(SESSION_COOKIE);
    }
    return response;
  }
}
