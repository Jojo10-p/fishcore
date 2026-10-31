import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";

/**
 * Premier filtre (edge) : vérifie la signature et le type de session.
 * La validité complète (révocation, statut du compte, permissions) est
 * contrôlée côté serveur dans chaque layout / action.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/connexion") && !pathname.startsWith("/admin/reinitialiser")) {
    if (!claims || claims.typ !== "STAFF") {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/connexion";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  if (pathname.startsWith("/espace")) {
    if (!claims || claims.typ !== "CUSTOMER") {
      const url = req.nextUrl.clone();
      url.pathname = "/connexion";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }
  const res = NextResponse.next();
  if (pathname.startsWith("/admin") || pathname.startsWith("/espace")) {
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = { matcher: ["/admin/:path*", "/espace/:path*"] };
