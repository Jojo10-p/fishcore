import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requirePermission,
  resolveCenterScope,
  requireCompany,
} from "@/lib/auth";

const registerSchema = z.object({
  centerId: z.string().min(1),
  name: z.string().trim().min(1, "Nom de la caisse requis"),
});

// GET /api/cash/registers?centerId=… — Caisses + session ouverte éventuelle
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "cash:view_session");
    const companyId = requireCompany(user);
    const centerScope = await resolveCenterScope(user, req.nextUrl.searchParams.get("centerId"));

    const registers = await prisma.cashRegister.findMany({
      where: { isActive: true, center: { companyId }, ...(centerScope ? { centerId: centerScope } : {}) },
      select: {
        id: true,
        name: true,
        state: true,
        centerId: true,
        center: { select: { name: true } },
        sessions: {
          where: { closedAt: null },
          select: { id: true, openedAt: true, cashierId: true, cashier: { select: { firstName: true, lastName: true } } },
          take: 1,
        },
      },
      orderBy: [{ centerId: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({
      success: true,
      data: registers.map(({ sessions, ...r }) => ({ ...r, openSession: sessions[0] ?? null })),
    });
  } catch (error) {
    return handleApiError(error, "REGISTERS");
  }
}

// POST /api/cash/registers — Ajouter une caisse à un centre (cahier §7.1)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "cash:register_manage");
    const { centerId, name } = parseBody(registerSchema, await readJson(req));
    await requireCenterAccess(user, centerId);
    const register = await prisma.cashRegister.create({ data: { centerId, name } });
    return NextResponse.json({ success: true, data: register }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "REGISTERS");
  }
}
