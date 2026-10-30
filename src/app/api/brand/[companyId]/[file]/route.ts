import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";

// Identité de l'entreprise pour l'application installée (public : un nom
// commercial et un logo ne sont pas des secrets ; l'identifiant est imprévisible).
//   /api/brand/{companyId}/manifest.webmanifest  → l'application porte le nom de l'entreprise
//   /api/brand/{companyId}/logo.png | icon-192.png | icon-512.png | maskable-512.png
type Ctx = { params: Promise<{ companyId: string; file: string }> };

const DEFAULT_ICONS: Record<string, string> = {
  "logo.png": "/icons/icon-512.png",
  "icon-512.png": "/icons/icon-512.png",
  "icon-192.png": "/icons/icon-192.png",
  "maskable-512.png": "/icons/icon-maskable-512.png",
};

export async function GET(req: NextRequest, { params }: Ctx) {
  const { companyId, file } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(companyId)) return new NextResponse("Not found", { status: 404 });

  if (file === "manifest.webmanifest") {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { tradeName: true, logoUrl: true, updatedAt: true },
    });
    if (!company) return new NextResponse("Not found", { status: 404 });
    const v = company.logoUrl ? new URL(company.logoUrl, req.nextUrl.origin).searchParams.get("v") ?? "1" : "0";
    const icon = (name: string) => (company.logoUrl ? `/api/brand/${companyId}/${name}?v=${v}` : DEFAULT_ICONS[name]);
    const manifest = {
      id: `/?app=${companyId}`,
      name: company.tradeName,
      short_name: company.tradeName.length > 18 ? company.tradeName.slice(0, 18).trim() : company.tradeName,
      description: `${company.tradeName} — ${APP_TAGLINE} (${APP_NAME})`,
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#f8fafc",
      theme_color: "#1d4ed8",
      lang: "fr",
      icons: [
        { src: icon("icon-192.png"), sizes: "192x192", type: "image/png" },
        { src: icon("icon-512.png"), sizes: "512x512", type: "image/png" },
        { src: icon("maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };
    return new NextResponse(JSON.stringify(manifest), {
      headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  if (!(file in DEFAULT_ICONS)) return new NextResponse("Not found", { status: 404 });
  const asset = await prisma.companyBrandAsset.findUnique({
    where: { companyId },
    select: file === "icon-192.png" ? { logo192: true } : file === "maskable-512.png" ? { maskable512: true } : { logo512: true },
  });
  const bytes = asset ? (("logo192" in asset && asset.logo192) || ("maskable512" in asset && asset.maskable512) || ("logo512" in asset && asset.logo512)) : null;
  if (!bytes) return NextResponse.redirect(new URL(DEFAULT_ICONS[file], req.nextUrl.origin), 302);
  return new NextResponse(Buffer.from(bytes as Uint8Array), {
    headers: {
      "Content-Type": "image/png",
      // Adresse versionnée (?v=) : un nouveau logo change l'adresse
      "Cache-Control": req.nextUrl.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
