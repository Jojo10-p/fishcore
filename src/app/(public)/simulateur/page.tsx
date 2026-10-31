import type { Metadata } from "next";
import { PageHero } from "@/components/site/page-hero";
import { Simulator } from "@/components/site/simulator";
import { getI18n } from "@/lib/i18n/server";
import { simulatorLabels } from "@/lib/i18n/labels";
import { getSettings } from "@/server/settings";
import { getActiveProducts } from "@/server/services/public";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Simulateur de financement" };

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [{ t }, settings, products] = await Promise.all([getI18n(), getSettings(), getActiveProducts()]);
  return (
    <>
      <PageHero label={t("nav.simulator")} title={t("simulator.title")} text={t("simulator.subtitle")} />
      <div className="container">
        {products.length ? (
          <Simulator
            products={products}
            currency={settings.locale.currency}
            numberLocale={settings.locale.numberLocale}
            labels={simulatorLabels(t)}
            initial={{ slug: sp.produit, amount: sp.montant ? Number(sp.montant) : settings.simulator.defaultAmount, duration: sp.duree ? Number(sp.duree) : settings.simulator.defaultDuration }}
          />
        ) : (
          <p className="rounded-2xl border border-dashed border-night/15 p-12 text-center text-ink-soft">{t("simulator.empty")}</p>
        )}
        <div className="mt-10 max-w-3xl text-sm leading-relaxed text-ink-faint">
          <p className="font-semibold text-ink-soft">Méthode de calcul</p>
          <p className="mt-2">Mensualité hors assurance : M = C × i(1+i)ⁿ / ((1+i)ⁿ − 1), où C est le capital, i le taux annuel divisé par 12 et n le nombre de mensualités. À taux nul, M = C / n. L'assurance éventuelle est calculée sur le capital initial et répartie sur chaque mois ; les frais de dossier sont ajoutés au coût total.</p>
        </div>
      </div>
    </>
  );
}
