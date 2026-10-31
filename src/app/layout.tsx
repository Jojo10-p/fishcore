import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/inter";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { getSettings } from "@/server/settings";
import { getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
    title: { default: s.seo.title, template: `%s — ${s.org.name}` },
    description: s.seo.description,
    openGraph: { title: s.seo.title, description: s.seo.description, siteName: s.org.name, images: s.seo.ogImage ? [s.seo.ogImage] : undefined, type: "website" },
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = { themeColor: "#101C35", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
