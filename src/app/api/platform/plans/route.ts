import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, parseBody, readJson } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform";

// GET /api/platform/plans — Offres (avec le nombre d'entreprises abonnées)
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { companies: true } } } });
    return NextResponse.json({ success: true, data: plans });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}

const schema = z.object({
  plans: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().trim().min(1).max(60),
        monthlyPrice: z.coerce.number().int().min(0),
        maxCenters: z.coerce.number().int().min(1).nullable(),
        maxUsers: z.coerce.number().int().min(1).nullable(),
        description: z.string().trim().max(200).nullable().optional(),
        isActive: z.boolean(),
      })
    )
    .min(1),
});

// PUT /api/platform/plans — Modifie prix et limites (les codes existants seulement)
export async function PUT(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const { plans } = parseBody(schema, await readJson(req));
    await prisma.$transaction(
      plans.map((p) =>
        prisma.plan.update({
          where: { code: p.code },
          data: { name: p.name, monthlyPrice: p.monthlyPrice, maxCenters: p.maxCenters, maxUsers: p.maxUsers, description: p.description ?? null, isActive: p.code === "TRIAL" ? false : p.isActive },
        })
      )
    );
    const updated = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { companies: true } } } });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}
