import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-in-production"
);

// Routes accessibles sans authentification
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/install",
  "/api/auth/login",
  "/api/auth/register",
  "/api/install",
  "/api/health",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?")
  );
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Laisser passer les assets statiques
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico")
  ) {
    return NextResponse.next();
  }

  // Routes publiques — toujours accessibles
  if (isPublicPath(pathname)) {
    // Si déjà connecté et tente d'accéder à /login ou /register → redirect dashboard
    if (pathname === "/login" || pathname === "/register") {
      const token = req.cookies.get("fishcore-session")?.value;
      if (token) {
        try {
          await jwtVerify(token, JWT_SECRET);
          return NextResponse.redirect(new URL("/dashboard", req.url));
        } catch {
          // Token invalide — laisser accéder à la page de login
        }
      }
    }
    return NextResponse.next();
  }

  // Vérifier l'authentification
  const token = req.cookies.get("fishcore-session")?.value;

  if (!token) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ success: false, error: "Non authentifié" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    // Injecter l'identité dans les headers pour les Server Components
    const requestHeaders = new Headers(req.headers);
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
      response.cookies.delete("fishcore-session");
      return response;
    }

    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete("fishcore-session");
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
