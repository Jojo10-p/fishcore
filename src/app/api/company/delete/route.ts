import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { purgeCompany } from "@/lib/account-deletion";
import { DELETION_REASON_CODES } from "@/lib/deletion-reasons";
import { SESSION_COOKIE } from "@/lib/secrets";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany } from "@/lib/auth";

const schema = z
  .object({
    password: z.string().min(1, "Mot de passe requis"),
    confirmName: z.string().trim().min(1, "Recopiez le nom de l'entreprise"),
    reasons: z.array(z.enum(DELETION_REASON_CODES)).min(1, "Dites-nous pourquoi vous partez (au moins une raison)").max(DELETION_REASON_CODES.length),
    otherReason: z.string().trim().max(1000).optional(),
  })
  .refine((d) => !d.reasons.includes("other") || (d.otherReason ?? "").length >= 3, { message: "Précisez votre raison", path: ["otherReason"] });

const normalize = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

// POST /api/company/delete — Suppression définitive du compte entreprise
// (propriétaire seulement, mot de passe + nom de l'entreprise recopié).
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const companyId = requireCompany(user);
    if (user.role !== "COMPANY_OWNER") throw new ApiError(403, "Seul le propriétaire peut supprimer le compte", "FORBIDDEN");
    const { password, confirmName, reasons, otherReason } = parseBody(schema, await readJson(req));

    const [owner, company] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } }),
      prisma.company.findUnique({ where: { id: companyId }, select: { tradeName: true } }),
    ]);
    if (!owner || !company) throw new ApiError(404, "Compte introuvable");
    if (!(await bcrypt.compare(password, owner.passwordHash))) throw new ApiError(400, "Mot de passe incorrect", "BAD_PASSWORD");
    if (normalize(confirmName) !== normalize(company.tradeName)) {
      throw new ApiError(400, `Recopiez exactement le nom « ${company.tradeName} »`, "CONFIRM_MISMATCH");
    }

    const counts = await purgeCompany(companyId, { reasons: [...new Set(reasons)], otherReason });
    console.info(`[ACCOUNT_DELETED] entreprise ${companyId} supprimée par son propriétaire`, counts);

    const response = NextResponse.json({ success: true, data: { deleted: true } });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (error) {
    return handleApiError(error, "ACCOUNT_DELETE");
  }
}
