import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requestMeta } from "@/lib/auth";
import { APP_NAME } from "@/lib/app-config";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { CODE_MAX_PER_HOUR, CODE_RESEND_SECONDS, CODE_TTL_MIN, codeMail, generateCode, hashCode, isSuperAdminEmail } from "@/lib/super-admin";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Email invalide") });

// POST /api/auth/code/request — 1re étape de connexion : l'adresse du super
// administrateur reçoit un code par e-mail ; les autres comptes passent au mot de passe.
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Email invalide" }, { status: 400 });
  const email = parsed.data.email;
  if (!isSuperAdminEmail(email)) return NextResponse.json({ success: true, data: { mode: "password" } });

  try {
    if (!mailConfigured()) {
      return NextResponse.json({ success: false, error: "L'envoi des codes par e-mail n'est pas encore configuré." }, { status: 503 });
    }
    const now = Date.now();
    const recent = await prisma.loginCode.findMany({ where: { email, createdAt: { gte: new Date(now - 3600_000) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const wait = recent[0] ? Math.ceil(CODE_RESEND_SECONDS - (now - recent[0].createdAt.getTime()) / 1000) : 0;
    if (wait > 0) return NextResponse.json({ success: false, error: `Patientez ${wait} s avant de redemander un code.`, data: { mode: "code", wait } }, { status: 429 });
    if (recent.length >= CODE_MAX_PER_HOUR) return NextResponse.json({ success: false, error: "Trop de codes demandés. Réessayez dans une heure." }, { status: 429 });

    const code = generateCode();
    const meta = requestMeta(req);
    // Les anciens codes ne servent plus
    await prisma.loginCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
    await prisma.loginCode.create({ data: { email, codeHash: hashCode(email, code), expiresAt: new Date(now + CODE_TTL_MIN * 60_000), ipAddress: meta.ipAddress ?? null } });
    await sendMail({ to: email, ...codeMail(code, APP_NAME) });
    return NextResponse.json({ success: true, data: { mode: "code", ttlMinutes: CODE_TTL_MIN } });
  } catch (e) {
    console.error("[AUTH] envoi du code", e);
    return NextResponse.json({ success: false, error: "Le code n'a pas pu être envoyé. Réessayez dans un instant." }, { status: 502 });
  }
}
