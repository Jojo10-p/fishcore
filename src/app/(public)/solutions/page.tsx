import Link from "next/link";
import type { Metadata } from "next";
import { Check, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHero } from "@/components/site/page-hero";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/server/settings";
import { getActiveProducts } from "@/server/services/public";
import { CATEGORY_META } from "@/lib/status";
import { formatMoney } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nos solutions de financement" };

export default async function SolutionsPage() {
  const [{ t, locale }, settings, products] = await Promise.all([getI18n(), getSettings(), getActiveProducts()]);
  const { currency, numberLocale } = settings.locale;
  const money = (n: number) => formatMoney(n, currency, numberLocale);
  const pct = (n: number) => `${n.toLocaleString(numberLocale, { maximumFractionDigits: 3 })} %`;

  return (
    <>
      <PageHero label={t("nav.solutions")} title={t("solutions.title")} text={t("solutions.subtitle")} />
      {products.length > 1 && (
        <nav className="container -mt-2 mb-6 flex gap-2 overflow-x-auto pb-2" aria-label="Offres">
          {products.map((p) => (
            <a key={p.id} href={`#${p.slug}`} className="whitespace-nowrap rounded-full border border-night/12 bg-white px-4 py-2 text-sm text-ink-soft hover:border-night/40 hover:text-ink">{p.name}</a>
          ))}
        </nav>
      )}
      <div className="container space-y-6">
        {products.length === 0 && <p className="rounded-2xl border border-dashed border-night/15 p-12 text-center text-ink-soft">{t("solutions.empty")}</p>}
        {products.map((p, i) => {
          const fees = [p.feesFixed > 0 ? money(p.feesFixed) : null, p.feesPercent > 0 ? `${pct(p.feesPercent)} du capital` : null].filter(Boolean).join(" + ");
          return (
            <article key={p.id} id={p.slug} className="scroll-mt-28 overflow-hidden rounded-[28px] border border-night/[.07] bg-white">
              <div className="grid lg:grid-cols-12">
                <div className={`p-7 sm:p-10 lg:col-span-7 ${i % 2 ? "lg:order-2" : ""}`}>
                  <p className="text-sm text-teal-700">{CATEGORY_META[p.category][locale]}</p>
                  <h2 className="mt-2 text-3xl font-bold">{p.name}</h2>
                  {p.tagline && <p className="mt-2 text-lg text-ink-soft">{p.tagline}</p>}
                  <p className="mt-5 max-w-2xl whitespace-pre-line leading-relaxed text-ink-soft">{p.description}</p>
                  <div className="mt-8 grid gap-8 sm:grid-cols-2">
                    <div>
                      <h3 className="mb-3 text-sm font-semibold">{t("solutions.eligibility")}</h3>
                      <ul className="space-y-2 text-[15px] text-ink-soft">
                        {p.eligibility.length ? p.eligibility.map((e) => <li key={e} className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-teal" />{e}</li>) : <li>{t("solutions.none")}</li>}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-3 text-sm font-semibold">{t("solutions.documents")}</h3>
                      <ul className="space-y-2 text-[15px] text-ink-soft">
                        {p.requiredDocuments.length ? p.requiredDocuments.map((d) => <li key={d.key + d.label} className="flex gap-2"><FileText className="mt-1 h-4 w-4 shrink-0 text-champagne-700" />{d.label}{!d.required && <span className="text-ink-faint">(facultatif)</span>}</li>) : <li>{t("solutions.none")}</li>}
                      </ul>
                    </div>
                  </div>
                </div>
                <aside className="flex flex-col bg-night p-7 text-white sm:p-10 lg:col-span-5">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-6">
                    <div className="col-span-2"><dt className="text-[13px] text-white/50">{t("solutions.rate")}</dt><dd className="tabular mt-1 font-display text-4xl font-extrabold text-champagne">{pct(p.annualRate)}</dd></div>
                    <div><dt className="text-[13px] text-white/50">{t("solutions.amount")}</dt><dd className="tabular mt-1 font-semibold">{money(p.minAmount)} – {money(p.maxAmount)}</dd></div>
                    <div><dt className="text-[13px] text-white/50">{t("solutions.duration")}</dt><dd className="tabular mt-1 font-semibold">{p.minDurationMonths} – {p.maxDurationMonths} {t("solutions.months")}</dd></div>
                    <div><dt className="text-[13px] text-white/50">{t("solutions.fees")}</dt><dd className="tabular mt-1 font-semibold">{fees || t("solutions.none")}</dd></div>
                    <div><dt className="text-[13px] text-white/50">{t("solutions.insurance")}</dt><dd className="tabular mt-1 font-semibold">{p.insuranceRate > 0 ? `${pct(p.insuranceRate)} / an` : t("solutions.none")}</dd></div>
                  </dl>
                  <div className="mt-auto flex flex-col gap-3 pt-10 sm:flex-row">
                    <Link href={`/simulateur?produit=${p.slug}`} className={buttonVariants({ variant: "outline-light", className: "flex-1" })}>{t("solutions.simulate")}</Link>
                    <Link href={`/demande?produit=${p.slug}`} className={buttonVariants({ variant: "teal", className: "flex-1" })}>{t("solutions.apply")}</Link>
                  </div>
                </aside>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
