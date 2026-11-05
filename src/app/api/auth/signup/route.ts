import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requestMeta, isUniqueViolation } from "@/lib/auth";
import { startSession } from "@/lib/session";

const schema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis").max(60),
  lastName: z.string().trim().min(1, "Nom requis").max(60),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(8, "Mot de passe : 8 caractères minimum").max(200),
});

// POST /api/auth/signup — n'importe qui crée son compte (e-mail + mot de passe).
// Le compte n'a accès à rien tant qu'il n'a pas rejoint l'entreprise avec le code du patron.
export async function POST(req: NextRequest) {
  const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const d = parsed.data;
    if (await prisma.user.findUnique({ where: { email: d.email }, select: { id: true } })) {
      return fail("Un compte existe déjà avec cet e-mail. Connectez-vous.", 409);
    }
    const user = await prisma.user.create({
      data: {
        email: d.email,
        firstName: d.firstName,
        lastName: d.lastName,
        phone: d.phone || null,
        passwordHash: await bcrypt.hash(d.password, 12),
        role: "CASHIER", // provisoire : le vrai poste vient du code du patron
        companyId: null,
      },
      select: { id: true, role: true, companyId: true },
    });
    const meta = requestMeta(req);
    await writeAuditLog({ eventType: "ACCOUNT_SIGNUP", userId: user.id, result: "SUCCESS", newValues: { email: d.email }, ...meta });
    return startSession(NextResponse.json({ success: true }, { status: 201 }), user, meta);
  } catch (error) {
    if (isUniqueViolation(error)) return fail("Un compte existe déjà avec cet e-mail. Connectez-vous.", 409);
    console.error("[SIGNUP]", error);
    return fail("Erreur interne du serveur", 500);
  }
}
