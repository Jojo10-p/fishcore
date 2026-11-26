import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";
import { ensureStandbyBlock } from "@/lib/invoice-numbers";

// ─────────────────────────────────────────────
// Réserve hors ligne de l'appareil
// ─────────────────────────────────────────────
// POST { deviceId } : avec du réseau, l'appareil garde de quoi ouvrir une
// caisse sans Internet : une plage de numéros de facture à son nom, les caisses
// où le caissier peut travailler (avec le montant de la dernière clôture) et
// l'en-tête des tickets. Appelé à l'ouverture de l'application ; idempotent.

const schema = z.object({ deviceId: z.string().min(4).max(100) });

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "cash:open_session");
    await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const { deviceId } = parseBody(schema, await readJson(req));

    const block = await prisma.$transaction((tx) => ensureStandbyBlock(tx, { companyId, userId: user.id, deviceId }));

    const centerIds = user.role === "COMPANY_OWNER" ? undefined : (await prisma.userCenter.findMany({ where: { userId: user.id, isActive: true }, select: { centerId: true } })).map((c) => c.centerId);
    const [registers, company, me] = await Promise.all([
      prisma.cashRegister.findMany({
        where: { isActive: true, center: { companyId }, ...(centerIds ? { centerId: { in: centerIds } } : {}) },
        select: { id: true, name: true, centerId: true, center: { select: { id: true, name: true, address: true, city: true, phone: true } } },
        orderBy: [{ centerId: "asc" }, { name: "asc" }],
      }),
      prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: {
          tradeName: true,
          logoUrl: true,
          legalName: true,
          phone: true,
          address: true,
          city: true,
          taxId: true,
          tradeRegNumber: true,
          currency: true,
          invoiceNotes: true,
          requiresPickup: true,
          invoiceFormat: true,
        },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { firstName: true, role: true } }),
    ]);
    const lastClosed = await prisma.cashSession.findMany({
      where: { cashRegisterId: { in: registers.map((r) => r.id) }, closedAt: { not: null } },
      orderBy: { closedAt: "desc" },
      distinct: ["cashRegisterId"],
      select: { cashRegisterId: true, closingBalance: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        userId: user.id,
        deviceId,
        blocks: [block],
        registers: registers.map((r) => ({
          ...r,
          lastClosing: Number(lastClosed.find((l) => l.cashRegisterId === r.id)?.closingBalance ?? 0),
        })),
        company,
        cashier: { firstName: me.firstName, role: me.role },
        savedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error, "STANDBY");
  }
}
