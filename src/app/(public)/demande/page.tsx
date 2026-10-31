import type { Metadata } from "next";
import { PageHero } from "@/components/site/page-hero";
import { ApplicationWizard } from "@/components/forms/application-wizard";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/server/settings";
import { getActiveProducts } from "@/server/services/public";
import { getCurrentUser } from "@/server/auth/session";
import { toNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demande de financement", robots: { index: false } };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [{ t }, settings, products, user] = await Promise.all([getI18n(), getSettings(), getActiveProducts(), getCurrentUser()]);
  const isStaff = user?.type === "STAFF";
  const c = user?.type === "CUSTOMER" ? user.customer : null;
  const prefill: Record<string, string> = c
    ? {
        lastName: c.lastName, firstName: c.firstName, birthDate: c.birthDate ? c.birthDate.toISOString().slice(0, 10) : "", nationality: c.nationality ?? "",
        email: user!.email, phone: c.phone, country: c.country, city: c.city, address: c.address, profession: c.profession ?? "",
        employmentStatus: c.employmentStatus ?? "", employer: c.employer ?? "", monthlyIncome: c.monthlyIncome ? String(toNumber(c.monthlyIncome)) : "", monthlyCharges: c.monthlyCharges ? String(toNumber(c.monthlyCharges)) : "0",
      }
    : user?.type === "CUSTOMER" ? { email: user.email, firstName: user.firstName, lastName: user.lastName } : {};

  return (
    <>
      <PageHero label={t("nav.apply")} title={t("apply.title")} text={t("apply.subtitle")} />
      <div className="container max-w-5xl">
        {isStaff ? (
          <p className="rounded-2xl border border-dashed border-night/15 p-10 text-center text-ink-soft">Vous êtes connecté avec un compte administrateur. Déconnectez-vous pour tester le parcours client.</p>
        ) : products.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-night/15 p-10 text-center text-ink-soft">{t("solutions.empty")}</p>
        ) : (
          <ApplicationWizard
            products={products}
            currency={settings.locale.currency}
            numberLocale={settings.locale.numberLocale}
            isLogged={user?.type === "CUSTOMER"}
            prefill={prefill}
            initial={{ productSlug: sp.produit, amount: sp.montant, duration: sp.duree }}
          />
        )}
      </div>
    </>
  );
}
