import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";

const schema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    // Fractionnable : se vend au quart, au demi… (0,25 carton, 1,5 kg)
    allowsDecimal: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "Aucune modification");

// PATCH /api/units/[id] — Modifier une unité de l'entreprise (les unités communes ne changent pas)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "unit:manage");
    const companyId = requireCompany(user);
    const { id } = await params;
    const data = parseBody(schema, await readJson(req));

    const unit = await prisma.$transaction(async (tx) => {
      const before = await tx.unit.findFirst({ where: { id, companyId }, select: { name: true, symbol: true, allowsDecimal: true } });
      if (!before) throw new ApiError(404, "Unité introuvable (les unités communes ne se modifient pas)");
      const updated = await tx.unit.update({ where: { id }, data, select: { id: true, name: true, symbol: true, allowsDecimal: true } });
      await writeAuditLog(
        {
          eventType: "COMPANY_SETTINGS_CHANGED",
          companyId,
          userId: user.id,
          referenceType: "Unit",
          referenceId: id,
          result: "SUCCESS",
          reason: `Unité « ${before.symbol} » modifiée`,
          oldValues: { name: before.name, allowsDecimal: String(before.allowsDecimal) },
          newValues: { name: updated.name, allowsDecimal: String(updated.allowsDecimal) },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return updated;
    });
    return NextResponse.json({ success: true, data: unit });
  } catch (error) {
    return handleApiError(error, "UNITS");
  }
}
