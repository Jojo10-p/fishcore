import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requestMeta } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { startSession } from "@/lib/session";
import { CODE_MAX_ATTEMPTS, hashCode, isSuperAdminEmail, normalizeCode, sameHash, superAdminCompanyId } from "@/lib/super-admin";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide"),
  code: z.string().min(4, "Code requis").max(20),
});

const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

// POST /api/auth/code/verify — 2e étape : le bon code connecte le super
// administrateur, avec le rôle de propriétaire de l'entreprise.
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const { email } = parsed.data;
    const code = normalizeCode(parsed.data.code);
    if (!isSuperAdminEmail(email)) return fail("Code invalide ou expiré");

    const entry = await prisma.loginCode.findFirst({ where: { email, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (!entry || entry.attempts >= CODE_MAX_ATTEMPTS) return fail("Code invalide ou expiré. Demandez un nouveau code.");
    if (!sameHash(entry.codeHash, hashCode(email, code))) {
      const attempts = entry.attempts + 1;
      await prisma.loginCode.update({ where: { id: entry.id }, data: { attempts, ...(attempts >= CODE_MAX_ATTEMPTS ? { usedAt: new Date() } : {}) } });
      const left = CODE_MAX_ATTEMPTS - attempts;
      return fail(left > 0 ? `Code incorrect. Encore ${left} essai${left > 1 ? "s" : ""}.` : "Code incorrect. Demandez un nouveau code.");
    }
    // Usage unique (protège contre deux validations simultanées)
    const used = await prisma.loginCode.updateMany({ where: { id: entry.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) return fail("Code déjà utilisé. Demandez un nouveau code.");

    const companyId = await superAdminCompanyId();
    if (!companyId) return fail("Aucune entreprise n'est configurée.", 500);
    const meta = requestMeta(req);

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { role: "COMPANY_OWNER", companyId, isActive: true, deactivatedAt: null },
          select: { id: true, role: true, companyId: true },
        })
      : await prisma.user.create({
          data: {
            email,
            firstName: "Super administrateur",
            lastName: "",
            role: "COMPANY_OWNER",
            companyId,
            // Pas de mot de passe utilisable : connexion par code uniquement
            passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10),
          },
          select: { id: true, role: true, companyId: true },
        });

    await writeAuditLog({ eventType: "USER_LOGIN", companyId, userId: user.id, result: "SUCCESS", newValues: { via: "code-email" }, ...meta });
    return startSession(NextResponse.json({ success: true, data: { user: { id: user.id, role: user.role } } }), user, meta);
  } catch (e) {
    console.error("[AUTH] vérification du code", e);
    return fail("Erreur interne du serveur", 500);
  }
}
