import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { processDocument, processPending } from "@/lib/emecf/normalize";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";

const schema = z.object({ saleId: z.string().optional() });

// POST /api/company/emecf/retry — Normaliser maintenant (une vente ou toutes celles en attente)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:view_all");
    const companyId = requireCompany(user);
    const { saleId } = parseBody(schema, await readJson(req));

    if (saleId) {
      const docs = await prisma.emecfDocument.findMany({ where: { saleId, companyId, status: { not: "NORMALIZED" } }, orderBy: { type: "desc" }, select: { id: true } });
      if (docs.length === 0) throw new ApiError(404, "Aucune facture à normaliser pour cette vente");
      // Demande explicite : on n'attend pas la fin du délai entre deux essais
      await prisma.emecfDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { nextAttemptAt: null } });
      const results = [];
      for (const d of docs) results.push(await processDocument(d.id));
      return NextResponse.json({ success: true, data: { documents: results } });
    }
    await prisma.emecfDocument.updateMany({ where: { companyId, status: { in: ["PENDING", "FAILED"] } }, data: { nextAttemptAt: null } });
    const result = await processPending(companyId, 20);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, "EMECF");
  }
}

export const maxDuration = 60;
