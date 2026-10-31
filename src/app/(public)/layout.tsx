import { Info } from "lucide-react";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { getSettings } from "@/server/settings";
import { getI18n } from "@/lib/i18n/server";
import { getCurrentUser } from "@/server/auth/session";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [settings, { t, locale }, user] = await Promise.all([getSettings(), getI18n(), getCurrentUser()]);
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-night focus:px-4 focus:py-2 focus:text-white">Aller au contenu</a>
      {!settings.compliance.licensed && (
        <div className="bg-champagne-50 text-[13px] text-champagne-700">
          <div className="container flex items-start gap-2 py-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t("compliance.banner")}</div>
        </div>
      )}
      <SiteHeader
        orgName={settings.org.name}
        logoUrl={settings.org.logoUrl || undefined}
        locale={locale}
        locales={settings.locale.enabled}
        isLogged={user?.type === "CUSTOMER"}
        labels={{ solutions: t("nav.solutions"), simulator: t("nav.simulator"), about: t("nav.about"), faq: t("nav.faq"), contact: t("nav.contact"), apply: t("nav.apply"), login: t("nav.login"), account: t("nav.account") }}
      />
      <main id="contenu" className="flex-1">{children}</main>
      <SiteFooter settings={settings} t={t} />
    </div>
  );
}
