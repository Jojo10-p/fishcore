import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createUserSchema } from "@/lib/validations";
import bcrypt from "bcryptjs";
import { writeAuditLog } from "@/lib/audit";

// GET /api/users — Lister les utilisateurs de l'entreprise
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");
    const centerId = searchParams.get("centerId");

    if (!companyId) {
      return NextResponse.json({ success: false, error: "companyId requis" }, { status: 400 });
    }

    const users = await prisma.user.findMany({
      where: {
        companyId,
        ...(centerId
          ? { centers: { some: { centerId, isActive: true } } }
          : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        avatarUrl: true,
        centers: {
          where: { isActive: true },
          include: {
            center: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Erreur serveur" }, { status: 500 });
  }
}

// POST /api/users — Créer un utilisateur
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { companyId, createdById } = body;
    if (!companyId) {
      return NextResponse.json({ success: false, error: "companyId requis" }, { status: 400 });
    }

    const { email, password, firstName, lastName, phone, role, centerIds } = parsed.data;

    // Vérifier que l'email n'est pas déjà utilisé
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "Un compte avec cet email existe déjà" },
        { status: 409 }
      );
    }

    // Vérifier que les centres appartiennent à l'entreprise
    const validCenters = await prisma.center.findMany({
      where: { id: { in: centerIds }, companyId },
      select: { id: true },
    });
    if (validCenters.length !== centerIds.length) {
      return NextResponse.json(
        { success: false, error: "Un ou plusieurs centres sont invalides" },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          companyId,
          email,
          passwordHash,
          firstName,
          lastName,
          phone,
          role,
          centers: {
            create: centerIds.map((centerId) => ({ centerId })),
          },
        },
        include: {
          centers: {
            include: { center: { select: { id: true, name: true, code: true } } },
          },
        },
      });
      return newUser;
    });

    await writeAuditLog({
      eventType: "USER_CREATED",
      companyId,
      userId: createdById ?? user.id,
      referenceType: "User",
      referenceId: user.id,
      result: "SUCCESS",
      newValues: { email, role, centerIds },
    });

    // Retourner sans le hash du mot de passe
    const { passwordHash: _h, ...safeUser } = user as typeof user & { passwordHash: string };
    return NextResponse.json({ success: true, data: safeUser }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
