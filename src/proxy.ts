import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getJwtSecret, SESSION_COOKIE } from "@/lib/secrets";

// Next.js 16 : « middleware » est renommé « proxy » (runtime Node.js).
// Ce proxy ne fait qu'un premier filtrage (redirection vers /login).
// Le contrôle d'accès RÉEL est fait dans chaque route API via
// getCurrentUser() + requirePermission() (src/lib/auth.ts).

const IDENTITY_HEADERS = ["x-user-id", "x-user-role", "x-company-id"];

// Routes accessibles sans authentification
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/install",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/signup",
  "/api/auth/password-reset",
  "/api/auth/google",
  "/api/auth/providers",
  "/api/invitations/accept",
  // Choisir sa boutique avant de taper le code du patron
  "/api/public/boutiques",
  "/rejoindre",
  "/mot-de-passe-oublie",
  "/reinitialiser",
  "/api/install",
  "/api/health",
  // Identité de l'entreprise pour l'application installée (nom, icônes)
  "/api/brand",
  // Fichiers de l'application installable (doivent rester accessibles hors session)
  "/sw.js",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?")
  );
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ne jamais faire confiance aux en-têtes d'identité envoyés par le client
  const requestHeaders = new Headers(req.headers);
  for (const h of IDENTITY_HEADERS) requestHeaders.delete(h);
  const passThrough = () => NextResponse.next({ request: { headers: requestHeaders } });

  // Laisser passer les assets statiques
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico")
  ) {
    return passThrough();
  }

  // Routes publiques — toujours accessibles
  if (isPublicPath(pathname)) {
    // Si déjà connecté et tente d'accéder à /login ou /register → redirect dashboard
    if (pathname === "/login" || pathname === "/register") {
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      if (token) {
        try {
          await jwtVerify(token, getJwtSecret());
          return NextResponse.redirect(new URL("/dashboard", req.url));
        } catch {
          // Token invalide — laisser accéder à la page de login
        }
      }
    }
    return passThrough();
  }

  // Vérifier l'authentification
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ success: false, error: "Non authentifié" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());

    // Indication d'identité pour les Server Components (non fiable pour les
    // autorisations : la session est revérifiée en base par getCurrentUser)
    requestHeaders.set("x-user-id", payload.sub as string);
    requestHeaders.set("x-user-role", (payload as { role?: string }).role ?? "");
    requestHeaders.set("x-company-id", (payload as { companyId?: string }).companyId ?? "");

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    // Token expiré ou invalide
    if (isApiPath(pathname)) {
      const response = NextResponse.json(
        { success: false, error: "Session expirée" },
        { status: 401 }
      );
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }

    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
