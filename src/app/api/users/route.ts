import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createUserSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  isUniqueViolation,
  parseBody,
  readJson,
  requireCompany,
  requirePermission,
  resolveCenterScope,
} from "@/lib/auth";

// GET /api/users — Utilisateurs de l'entreprise (limités aux centres visibles)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "user:view");
    const companyId = requireCompany(user);

    const { searchParams } = new URL(req.url);
    const centerScope = await resolveCenterScope(user, searchParams.get("centerId"));

    const users = await prisma.user.findMany({
      where: {
        companyId,
        ...(centerScope ? { centers: { some: { centerId: centerScope, isActive: true } } } : {}),
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
          include: { center: { select: { id: true, name: true, code: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    return handleApiError(error, "USERS");
  }
}

// POST /api/users — Créer un compte employé
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "user:create");
    const companyId = requireCompany(user);
    const { email, password, firstName, lastName, phone, role, centerIds } = parseBody(
      createUserSchema,
      await readJson(req)
    );

    // Seul un propriétaire peut créer un autre propriétaire
    if (role === "COMPANY_OWNER" && user.role !== "COMPANY_OWNER") {
      throw new ApiError(403, "Seul le propriétaire peut créer un compte propriétaire", "FORBIDDEN");
    }

    // Les centres doivent appartenir à l'entreprise et être accessibles au créateur
    const uniqueCenterIds = [...new Set(centerIds)];
    if (user.role !== "COMPANY_OWNER" && uniqueCenterIds.some((c) => !user.centerIds.includes(c))) {
      throw new ApiError(403, "Vous ne pouvez affecter un compte qu'à vos propres centres", "FORBIDDEN");
    }
    const validCenters = await prisma.center.findMany({
      where: { id: { in: uniqueCenterIds }, companyId },
      select: { id: true },
    });
    if (validCenters.length !== uniqueCenterIds.length) {
      throw new ApiError(400, "Un ou plusieurs centres sont invalides");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const created = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          companyId,
          email,
          passwordHash,
          firstName,
          lastName,
          phone,
          role,
          centers: { create: uniqueCenterIds.map((centerId) => ({ centerId })) },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          centers: { include: { center: { select: { id: true, name: true, code: true } } } },
        },
      });

      await writeAuditLog(
        {
          eventType: "USER_CREATED",
          companyId,
          userId: user.id,
          referenceType: "User",
          referenceId: newUser.id,
          result: "SUCCESS",
          newValues: { email, role, centerIds: uniqueCenterIds },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );

      return newUser;
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: false, error: "Un compte avec cet email existe déjà" }, { status: 409 });
    }
    return handleApiError(error, "USERS");
  }
}
