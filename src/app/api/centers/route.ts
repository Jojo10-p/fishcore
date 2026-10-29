import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centerSchema, generateInstallLinkSchema } from "@/lib/validations";
import { generateInstallLink } from "@/lib/install-link";
import { writeAuditLog } from "@/lib/audit";

// GET /api/centers — Lister les centres d'une entreprise
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: "companyId requis" },
        { status: 400 }
      );
    }

    const centers = await prisma.center.findMany({
      where: { companyId },
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
        installLinks: {
          where: { isUsed: false, expiresAt: { gt: new Date() } },
          select: { id: true, token: true, expiresAt: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: {
          select: { stocks: true, receipts: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, data: centers });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Erreur serveur" },
      { status: 500 }
    );
  }
}

// POST /api/centers — Créer un centre
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = centerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { companyId, createdById } = body;
    if (!companyId || !createdById) {
      return NextResponse.json(
        { success: false, error: "companyId et createdById requis" },
        { status: 400 }
      );
    }

    // Vérifier unicité du code dans l'entreprise
    const existing = await prisma.center.findUnique({
      where: { companyId_code: { companyId, code: parsed.data.code } },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Le code "${parsed.data.code}" est déjà utilisé dans cette entreprise` },
        { status: 409 }
      );
    }

    const center = await prisma.$transaction(async (tx) => {
      const newCenter = await tx.center.create({
        data: {
          companyId,
          name: parsed.data.name,
          code: parsed.data.code,
          address: parsed.data.address,
          city: parsed.data.city,
          phone: parsed.data.phone,
          managerId: parsed.data.managerId,
        },
      });

      // Créer une caisse par défaut
      await tx.cashRegister.create({
        data: {
          centerId: newCenter.id,
          name: "Caisse principale",
        },
      });

      return newCenter;
    });

    await writeAuditLog({
      eventType: "CENTER_CREATED",
      companyId,
      centerId: center.id,
      userId: createdById,
      referenceType: "Center",
      referenceId: center.id,
      result: "SUCCESS",
      newValues: { name: center.name, code: center.code },
    });

    return NextResponse.json({ success: true, data: center }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
