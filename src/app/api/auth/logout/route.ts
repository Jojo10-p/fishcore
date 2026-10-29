import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";
import { writeAuditLog } from "@/lib/audit";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-in-production"
);

// POST /api/auth/logout
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("fishcore-session")?.value;

    if (token) {
      try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        const userId = payload.sub as string;

        // Supprimer la session de la DB
        await prisma.authSession.deleteMany({
          where: { sessionToken: token },
        });

        await writeAuditLog({
          eventType: "USER_LOGOUT",
          userId,
          result: "SUCCESS",
        });
      } catch {
        // Token invalide — on nettoie quand même le cookie
      }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.delete("fishcore-session");
    return response;
  } catch (error) {
    return NextResponse.json({ success: false, error: "Erreur interne" }, { status: 500 });
  }
}

// GET /api/auth/me — Vérifier la session courante
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("fishcore-session")?.value;

    if (!token) {
      return NextResponse.json({ success: false, error: "Non authentifié" }, { status: 401 });
    }

    let payload: { sub?: string; role?: string; companyId?: string; centerIds?: string[] };
    try {
      const result = await jwtVerify(token, JWT_SECRET);
      payload = result.payload as typeof payload;
    } catch {
      const response = NextResponse.json(
        { success: false, error: "Session expirée" },
        { status: 401 }
      );
      response.cookies.delete("fishcore-session");
      return response;
    }

    // Vérifier que la session existe en DB
    const session = await prisma.authSession.findUnique({
      where: { sessionToken: token },
    });
    if (!session || session.expires < new Date()) {
      const response = NextResponse.json(
        { success: false, error: "Session expirée" },
        { status: 401 }
      );
      response.cookies.delete("fishcore-session");
      return response;
    }

    // Récupérer l'utilisateur complet
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        companyId: true,
        company: {
          select: {
            id: true,
            tradeName: true,
            logoUrl: true,
            currency: true,
            timezone: true,
            isActive: true,
          },
        },
        centers: {
          where: { isActive: true },
          include: {
            center: {
              select: { id: true, name: true, code: true, status: true },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return NextResponse.json({ success: false, error: "Utilisateur introuvable" }, { status: 401 });
    }

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
        centers: user.centers.map((uc) => uc.center),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Erreur interne" }, { status: 500 });
  }
}
