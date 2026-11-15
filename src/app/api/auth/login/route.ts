import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { loginSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit";
import { getJwtSecret, SESSION_COOKIE, SESSION_DURATION_MS } from "@/lib/secrets";
import { hashSessionToken, requestMeta } from "@/lib/auth";

// Hash factice : compare un mot de passe même quand l'email est inconnu,
// pour que le temps de réponse ne révèle pas quels comptes existent.
const DUMMY_HASH = "$2b$12$Ds3wqaTCLljZMJry0dRF/.gpINT9wrl4s79/Dw8JnlfAla/Br9YI2";

// POST /api/auth/login
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = loginSchema.safeParse(body);
    const meta = requestMeta(req);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides" },
        { status: 400 }
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const { password } = parsed.data;

    // Trouver l'utilisateur
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        company: {
          select: {
            id: true,
            tradeName: true,
            appName: true,
            logoUrl: true,
            currency: true,
            timezone: true,
            isActive: true,
          },
        },
        centers: {
          where: { isActive: true },
          include: {
            center: { select: { id: true, name: true, code: true, status: true } },
          },
        },
      },
    });

    // Utilisateur introuvable
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return NextResponse.json(
        { success: false, error: "Email ou mot de passe incorrect" },
        { status: 401 }
      );
    }

    // Compte désactivé
    if (!user.isActive) {
      return NextResponse.json(
        { success: false, error: "Ce compte est désactivé. Contactez votre administrateur." },
        { status: 403 }
      );
    }

    // Compte verrouillé
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return NextResponse.json(
        {
          success: false,
          error: `Compte temporairement verrouillé. Réessayez dans ${minutes} minute(s).`,
        },
        { status: 423 }
      );
    }

    // Entreprise suspendue
    if (user.company && !user.company.isActive) {
      return NextResponse.json(
        { success: false, error: "L'abonnement de cette entreprise est suspendu." },
        { status: 403 }
      );
    }

    // Vérifier le mot de passe
    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      const attempts = user.loginAttempts + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await prisma.user.update({
        where: { id: user.id },
        data: { loginAttempts: attempts, lockedUntil },
      });

      await writeAuditLog({
        eventType: "LOGIN_FAILED",
        companyId: user.companyId ?? undefined,
        userId: user.id,
        result: "FAILED",
        reason: `Tentative ${attempts}/5`,
        ...meta,
      });

      return NextResponse.json(
        {
          success: false,
          error:
            attempts >= 5
              ? "Compte verrouillé 15 minutes après trop de tentatives échouées."
              : `Email ou mot de passe incorrect (tentative ${attempts}/5)`,
        },
        { status: 401 }
      );
    }

    // Succès — réinitialiser les compteurs
    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // Créer la session en DB
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    // Le JWT ne porte que l'identité minimale : les droits et les centres
    // sont relus en base à chaque requête (getCurrentUser).
    const token = await new SignJWT({
      sub: user.id,
      role: user.role,
      companyId: user.companyId,
      jti: crypto.randomUUID(),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .setIssuedAt()
      .sign(getJwtSecret());

    // Enregistrer la session (empreinte du jeton, jamais le jeton en clair)
    await prisma.authSession.create({
      data: {
        userId: user.id,
        sessionToken: hashSessionToken(token),
        expires: expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    await writeAuditLog({
      eventType: "USER_LOGIN",
      companyId: user.companyId ?? undefined,
      userId: user.id,
      result: "SUCCESS",
      ...meta,
    });

    // Réponse avec cookie httpOnly
    const response = NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          avatarUrl: user.avatarUrl,
        },
        company: user.company,
        centers: user.centers.map((uc) => uc.center),
      },
    });

    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[AUTH] Erreur login:", error);
    return NextResponse.json(
      { success: false, error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
