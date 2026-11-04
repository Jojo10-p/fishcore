import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { OAUTH_COOKIE, googleAuthUrl, googleConfigured, signOAuthState } from "@/lib/google";
import { publicOrigin } from "@/lib/password-reset";

// GET /api/auth/google/start?invite=<jeton> — part chez Google (choix du compte)
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req.nextUrl.origin);
  if (!googleConfigured()) return NextResponse.redirect(`${origin}/login?erreur=google-indisponible`);
  const state = crypto.randomBytes(16).toString("base64url");
  const nonce = crypto.randomBytes(16).toString("base64url");
  const invite = req.nextUrl.searchParams.get("invite");
  const res = NextResponse.redirect(googleAuthUrl(origin, state, nonce));
  res.cookies.set(OAUTH_COOKIE, await signOAuthState({ state, nonce, invite }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/auth/google",
  });
  return res;
}
