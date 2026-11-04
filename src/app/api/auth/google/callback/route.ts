import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requestMeta } from "@/lib/auth";
import { startSession } from "@/lib/session";
import { publicOrigin } from "@/lib/password-reset";
import { OAUTH_COOKIE, exchangeGoogleCode, readOAuthState } from "@/lib/google";
import { createUserFromInvitation, findValidInvitation } from "@/lib/invitations";

// GET /api/auth/google/callback — retour de Google : connexion, ou création du
// compte si la personne arrive avec un lien d'invitation.
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req.nextUrl.origin);
  const back = (path: string) => {
    const r = NextResponse.redirect(`${origin}${path}`);
    r.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
    return r;
  };
  const saved = await readOAuthState(req.cookies.get(OAUTH_COOKIE)?.value);
  const invitePath = saved?.invite ? `/rejoindre/${saved.invite}` : "/login";
  try {
    const code = req.nextUrl.searchParams.get("code");
    if (!saved || !code || req.nextUrl.searchParams.get("state") !== saved.state) return back(`${invitePath}?erreur=google-annule`);
    const g = await exchangeGoogleCode(code, origin, saved.nonce);
    if (!g.emailVerified || !g.email) return back(`${invitePath}?erreur=google-email`);
    const meta = requestMeta(req);

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleSub: g.sub }, { email: g.email }] },
      select: { id: true, role: true, companyId: true, isActive: true, googleSub: true, company: { select: { isActive: true } } },
    });
    if (user) {
      if (!user.isActive) return back("/login?erreur=compte-desactive");
      if (user.company && !user.company.isActive) return back("/login?erreur=entreprise-suspendue");
      // Même adresse e-mail (vérifiée par Google) : le compte est relié à Google
      if (!user.googleSub) await prisma.user.update({ where: { id: user.id }, data: { googleSub: g.sub } });
    } else {
      if (!saved.invite) return back("/login?erreur=google-inconnu");
      const found = await findValidInvitation(saved.invite);
      if (!found.ok) return back(`/rejoindre/${saved.invite}?erreur=invitation`);
      // Compte Google uniquement : mot de passe aléatoire (il pourra en choisir un plus tard)
      const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10);
      const created = await createUserFromInvitation(found.invitation, { email: g.email, firstName: g.givenName, lastName: g.familyName, passwordHash, googleSub: g.sub });
      await writeAuditLog({ eventType: "INVITATION_ACCEPTED", companyId: created.companyId ?? undefined, userId: created.id, referenceType: "Invitation", referenceId: found.invitation.id, result: "SUCCESS", newValues: { email: g.email, role: created.role, via: "google" }, ...meta });
      user = { ...created, isActive: true, googleSub: g.sub, company: { isActive: true } };
    }
    await writeAuditLog({ eventType: "GOOGLE_LOGIN", companyId: user.companyId ?? undefined, userId: user.id, result: "SUCCESS", ...meta });
    return startSession(back("/dashboard"), user, meta);
  } catch (e) {
    console.error("[GOOGLE]", e);
    return back(`${invitePath}?erreur=google`);
  }
}
