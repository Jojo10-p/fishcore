import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import { getJwtSecret } from "@/lib/secrets";

// Connexion avec Google (OpenID Connect, sans bibliothèque externe).
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET : identifiants OAuth (console Google Cloud),
//   à mettre dans les réglages Vercel. Adresse de retour autorisée :
//   https://<domaine>/api/auth/google/callback

export const OAUTH_COOKIE = "gjh-oauth";
export function googleConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
}

/** Jeton d'état signé (anti-CSRF), gardé 10 minutes dans un cookie. */
export async function signOAuthState(data: { state: string; nonce: string; invite?: string | null }): Promise<string> {
  return new SignJWT({ ...data, invite: data.invite ?? null })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getJwtSecret());
}

export async function readOAuthState(cookie: string | undefined): Promise<{ state: string; nonce: string; invite: string | null } | null> {
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, getJwtSecret());
    return { state: String(payload.state), nonce: String(payload.nonce), invite: (payload.invite as string | null) ?? null };
  } catch {
    return null;
  }
}

export function googleAuthUrl(origin: string, state: string, nonce: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  givenName: string;
  familyName: string;
}

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Échange le code contre le profil Google vérifié (signature, émetteur, audience, nonce). */
export async function exchangeGoogleCode(code: string, origin: string, nonce: string): Promise<GoogleProfile> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google a refusé la connexion (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Réponse Google incomplète");
  const { payload } = await jwtVerify(id_token, JWKS, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: process.env.GOOGLE_CLIENT_ID! });
  if (payload.nonce !== nonce) throw new Error("Connexion Google invalide (nonce)");
  const name = String(payload.name ?? "").trim();
  return {
    sub: String(payload.sub),
    email: String(payload.email ?? "").toLowerCase(),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    givenName: String(payload.given_name ?? name.split(" ")[0] ?? "").trim() || "Utilisateur",
    familyName: String(payload.family_name ?? name.split(" ").slice(1).join(" ") ?? "").trim() || "—",
  };
}
