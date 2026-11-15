import { ownerRoleLocked } from "@/lib/super-admin";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centerSchema } from "@/lib/validations";
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
  visibleCenterFilter,
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

// GET /api/centers — Centres visibles par l'utilisateur
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "center:view");
    const companyId = requireCompany(user);
    const centerFilter = visibleCenterFilter(user);
    const canSeeLinks = hasPermission(user.role, "install_link:generate");

    const centers = await prisma.center.findMany({
      where: { companyId, ...(centerFilter ? { id: centerFilter } : {}) },
      include: {
        cashRegisters: {
          where: { isActive: true },
          select: { id: true, name: true, state: true },
        },
        users: {
          where: { isActive: true },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
        // Les liens d'installation sont des secrets : réservés à ceux qui peuvent en générer
        ...(canSeeLinks
          ? {
              installLinks: {
                where: { isUsed: false, expiresAt: { gt: new Date() } },
                select: { id: true, expiresAt: true, createdAt: true },
                orderBy: { createdAt: "desc" as const },
                take: 1,
              },
            }
          : {}),
        _count: { select: { stocks: true, receipts: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, data: centers });
  } catch (error) {
    return handleApiError(error, "CENTERS");
  }
}

// POST /api/centers — Créer un centre (avec une caisse par défaut)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "center:create");
    const companyId = requireCompany(user);
    const data = parseBody(centerSchema, await readJson(req));
    // Seul le super administrateur ouvre une nouvelle boutique
    if ((await ownerRoleLocked(companyId)) && !(await prisma.user.count({ where: { id: user.id, isSuperAdmin: true } }))) {
      throw new ApiError(403, "Seul le super administrateur peut ouvrir une nouvelle boutique", "FORBIDDEN");
    }
    const code = data.code ?? (await freeCenterCode(companyId, data.name));

    if (data.managerId) {
      const manager = await prisma.user.findFirst({
        where: { id: data.managerId, companyId, isActive: true },
        select: { id: true },
      });
      if (!manager) throw new ApiError(400, "Responsable introuvable dans votre entreprise");
    }

    const center = await prisma.$transaction(async (tx) => {
      const newCenter = await tx.center.create({
        data: {
          companyId,
          name: data.name,
          code,
          address: data.address,
          city: data.city,
          phone: data.phone,
          managerId: data.managerId,
        },
      });

      await tx.cashRegister.create({
        data: { centerId: newCenter.id, name: "Caisse principale" },
      });

      // Le responsable désigné est affecté au centre
      if (data.managerId) {
        await tx.userCenter.upsert({
          where: { userId_centerId: { userId: data.managerId, centerId: newCenter.id } },
          create: { userId: data.managerId, centerId: newCenter.id },
          update: { isActive: true },
        });
      }

      await writeAuditLog(
        {
          eventType: "CENTER_CREATED",
          companyId,
          centerId: newCenter.id,
          userId: user.id,
          referenceType: "Center",
          referenceId: newCenter.id,
          result: "SUCCESS",
          newValues: { name: newCenter.name, code: newCenter.code },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );

      return newCenter;
    });

    return NextResponse.json({ success: true, data: center }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { success: false, error: "Ce code de centre est déjà utilisé dans votre entreprise" },
        { status: 409 }
      );
    }
    return handleApiError(error, "CENTERS");
  }
}

/** Code interne unique tiré du nom : « Abomey-Calavi » → ABOMEY, puis ABOMEY2… */
async function freeCenterCode(companyId: string, name: string): Promise<string> {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || "BOUT";
  const taken = new Set((await prisma.center.findMany({ where: { companyId, code: { startsWith: base } }, select: { code: true } })).map((c) => c.code));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}
