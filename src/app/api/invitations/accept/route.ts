import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requestMeta } from "@/lib/auth";
import { startSession } from "@/lib/session";
import { ROLE_NAMES, createUserFromInvitation, findValidInvitation } from "@/lib/invitations";
import { googleConfigured } from "@/lib/google";

const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

// GET /api/invitations/accept?token= — à qui et pour quel poste est ce lien (public)
export async function GET(req: NextRequest) {
  const found = await findValidInvitation(req.nextUrl.searchParams.get("token") ?? "");
  if (!found.ok) return fail(found.error, 404);
  const inv = found.invitation;
  return NextResponse.json({
    success: true,
    data: { companyName: inv.company.tradeName, role: inv.role, roleName: ROLE_NAMES[inv.role], centerName: inv.center?.name ?? null, label: inv.label, expiresAt: inv.expiresAt, google: googleConfigured() },
  });
}

const schema = z
  .object({
    token: z.string().min(20),
    firstName: z.string().trim().min(1, "Prénom requis").max(60),
    lastName: z.string().trim().min(1, "Nom requis").max(60),
    email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
    phone: z.string().trim().max(30).optional(),
    password: z.string().min(8, "Mot de passe : 8 caractères minimum").max(200),
  })
  .strict();

// POST /api/invitations/accept — l'employé crée son compte et est connecté aussitôt
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Données invalides");
    const d = parsed.data;
    const found = await findValidInvitation(d.token);
    if (!found.ok) return fail(found.error, 410);
    if (await prisma.user.findUnique({ where: { email: d.email }, select: { id: true } })) {
      return fail("Un compte existe déjà avec cet e-mail. Connectez-vous, ou utilisez une autre adresse.", 409);
    }
    const passwordHash = await bcrypt.hash(d.password, 12);
    let user;
    try {
      user = await createUserFromInvitation(found.invitation, { email: d.email, firstName: d.firstName, lastName: d.lastName, phone: d.phone || null, passwordHash });
    } catch (e) {
      if ((e as Error).message === "INVITATION_USED") return fail("Ce lien a déjà servi.", 410);
      throw e;
    }
    const meta = requestMeta(req);
    await writeAuditLog({ eventType: "INVITATION_ACCEPTED", companyId: user.companyId ?? undefined, userId: user.id, referenceType: "Invitation", referenceId: found.invitation.id, result: "SUCCESS", newValues: { email: d.email, role: user.role }, ...meta });
    return startSession(NextResponse.json({ success: true, data: { role: user.role } }, { status: 201 }), user, meta);
  } catch (error) {
    console.error("[INVITATION]", error);
    return fail("Erreur interne du serveur", 500);
  }
}
