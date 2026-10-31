import Link from "next/link";
import { FileCheck2, LockKeyhole, History, BadgeCheck, Plus, Quote, Star } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/surface";
import { HeroVisual } from "@/components/site/hero-visual";
import { Simulator } from "@/components/site/simulator";
import { getI18n } from "@/lib/i18n/server";
import { simulatorLabels } from "@/lib/i18n/labels";
import { getSettings } from "@/server/settings";
import { getActiveProducts, getPublicStats, getPublishedFaqs, getPublishedTestimonials } from "@/server/services/public";
import { CATEGORY_META } from "@/lib/status";
import { formatMoney } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ t, locale }, settings, products] = await Promise.all([getI18n(), getSettings(), getActiveProducts()]);
  const [stats, faqs, testimonials] = await Promise.all([getPublicStats(), getPublishedFaqs(locale, 4), getPublishedTestimonials(locale)]);
  const { currency, numberLocale } = settings.locale;
  const money = (n: number) => formatMoney(n, currency, numberLocale);
  const [featured, ...others] = products;

  const steps = [1, 2, 3, 4, 5] as const;
  const advantages = [
    { icon: FileCheck2, k: 1 },
    { icon: LockKeyhole, k: 2 },
    { icon: History, k: 3 },
    { icon: BadgeCheck, k: 4 },
  ] as const;

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-teal/[.07] blur-3xl" aria-hidden />
        <div className="container grid items-center gap-12 pb-20 pt-10 lg:grid-cols-12 lg:gap-10 lg:pb-28 lg:pt-16">
          <div className="lg:col-span-7">
            <p className="label-sm mb-5">{t("home.hero.eyebrow")}</p>
            <h1 className="max-w-[16ch] text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl lg:text-[4.1rem]">{t("home.hero.title")}</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">{t("home.hero.subtitle")}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/solutions" className={buttonVariants({ size: "lg" })}>{t("home.hero.ctaPrimary")}</Link>
              <Link href="/simulateur" className={buttonVariants({ size: "lg", variant: "outline" })}>{t("home.hero.ctaSecondary")}</Link>
            </div>
            {stats && (
              <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-night/10 pt-6">
                <div><dt className="text-[13px] text-ink-faint">{t("home.stats.applications")}</dt><dd className="tabular mt-1 font-display text-2xl font-bold">{stats.reviewed.toLocaleString(numberLocale)}</dd></div>
                <div><dt className="text-[13px] text-ink-faint">{t("home.stats.products")}</dt><dd className="tabular mt-1 font-display text-2xl font-bold">{stats.products}</dd></div>
                {stats.avgFirstResponseHours !== null && (
                  <div><dt className="text-[13px] text-ink-faint">{t("home.stats.response")}</dt><dd className="tabular mt-1 font-display text-2xl font-bold">{stats.avgFirstResponseHours < 48 ? `${Math.round(stats.avgFirstResponseHours)} h` : `${Math.round(stats.avgFirstResponseHours / 24)} j`}</dd></div>
                )}
              </dl>
            )}
          </div>
          <div className="lg:col-span-5">
            <HeroVisual product={featured} currency={currency} numberLocale={numberLocale} months={t("common.month")} />
          </div>
        </div>
      </section>

      {/* SOLUTIONS */}
      <section className="container py-16 lg:py-24" aria-labelledby="sol-title">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <SectionHeading label={t("home.solutions.eyebrow")} title={t("home.solutions.title")} text={t("home.solutions.subtitle")} />
          <Link href="/solutions" className={buttonVariants({ variant: "outline", className: "self-start lg:self-auto" })}>{t("nav.solutions")}</Link>
        </div>
        {products.length === 0 ? (
          <p className="mt-12 rounded-2xl border border-dashed border-night/15 p-10 text-center text-ink-soft">{t("solutions.empty")}</p>
        ) : (
          <div className="mt-12 grid gap-5 lg:grid-cols-12">
            <Link href={`/solutions#${featured.slug}`} className="group relative overflow-hidden rounded-[28px] bg-slate2 p-8 text-white transition hover:shadow-lift lg:col-span-5 lg:row-span-2 lg:p-10">
              <div className="grain pointer-events-none absolute inset-0" aria-hidden />
              <div className="relative flex h-full flex-col">
                <p className="text-sm text-champagne">{CATEGORY_META[featured.category][locale]}</p>
                <h3 className="mt-3 text-3xl font-bold text-white">{featured.name}</h3>
                {featured.tagline && <p className="mt-3 text-white/70">{featured.tagline}</p>}
                <dl className="mt-auto grid grid-cols-2 gap-6 pt-14">
                  <div><dt className="text-[13px] text-white/50">{t("solutions.amount")}</dt><dd className="tabular mt-1 font-semibold">{money(featured.minAmount)} – {money(featured.maxAmount)}</dd></div>
                  <div><dt className="text-[13px] text-white/50">{t("solutions.rate")}</dt><dd className="tabular mt-1 font-display text-2xl font-bold text-champagne">{featured.annualRate.toLocaleString(numberLocale)} %</dd></div>
                </dl>
              </div>
            </Link>
            {others.map((p) => (
              <Link key={p.id} href={`/solutions#${p.slug}`} className="group grid grid-cols-[1fr_auto] items-center gap-6 rounded-[22px] border border-night/[.08] bg-white p-6 transition hover:border-night/25 lg:col-span-7 lg:p-7">
                <div>
                  <p className="text-[13px] text-teal-700">{CATEGORY_META[p.category][locale]}</p>
                  <h3 className="mt-1 text-xl font-bold">{p.name}</h3>
                  <p className="tabular mt-2 text-sm text-ink-soft">{money(p.minAmount)} – {money(p.maxAmount)} · {p.minDurationMonths}–{p.maxDurationMonths} {t("common.month")}</p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-ink-faint">{t("solutions.rate")}</p>
                  <p className="tabular font-display text-2xl font-bold">{p.annualRate.toLocaleString(numberLocale)} %</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* SIMULATEUR */}
      {products.length > 0 && (
        <section id="simulateur" className="bg-mist/60 py-16 lg:py-24" aria-labelledby="sim-title">
          <div className="container">
            <SectionHeading label={t("home.simulator.eyebrow")} title={t("home.simulator.title")} text={t("home.simulator.subtitle")} className="mb-12" />
            <Simulator products={products} currency={currency} numberLocale={numberLocale} labels={simulatorLabels(t)} variant="compact" initial={{ amount: settings.simulator.defaultAmount, duration: settings.simulator.defaultDuration }} />
          </div>
        </section>
      )}

      {/* FONCTIONNEMENT */}
      <section className="container py-16 lg:py-24">
        <SectionHeading label={t("home.process.eyebrow")} title={t("home.process.title")} />
        <ol className="relative mt-14 grid gap-8 md:grid-cols-5 md:gap-5">
          <div className="absolute left-[19px] top-2 bottom-2 w-px bg-night/10 md:left-0 md:right-0 md:top-[19px] md:bottom-auto md:h-px md:w-auto" aria-hidden />
          {steps.map((n) => (
            <li key={n} className="relative flex gap-5 md:block">
              <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-night/15 bg-paper font-display text-sm font-bold">{n}</span>
              <div className="md:mt-6">
                <h3 className="text-lg font-bold">{t(`home.process.${n}.title`)}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{t(`home.process.${n}.text`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ENGAGEMENTS */}
      <section className="container grid gap-12 py-16 lg:grid-cols-12 lg:py-24">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <SectionHeading label={t("home.advantages.eyebrow")} title={t("home.advantages.title")} />
          </div>
        </div>
        <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:col-span-8">
          {advantages.map(({ icon: Icon, k }) => (
            <div key={k} className="border-t border-night/10 pt-6">
              <Icon className="h-6 w-6 text-teal" strokeWidth={1.6} />
              <h3 className="mt-5 text-xl font-bold">{t(`home.advantages.${k}.title`)}</h3>
              <p className="mt-2 leading-relaxed text-ink-soft">{t(`home.advantages.${k}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TÉMOIGNAGES — uniquement ceux avec consentement enregistré */}
      {testimonials.length > 0 && (
        <section className="bg-night py-16 text-white lg:py-24">
          <div className="container">
            <SectionHeading invert label={t("home.testimonials.eyebrow")} title={t("home.testimonials.title")} />
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {testimonials.map((tm) => (
                <figure key={tm.id} className="flex flex-col rounded-[22px] border border-white/10 bg-white/[.03] p-7">
                  <Quote className="h-6 w-6 text-champagne" />
                  {tm.rating && (
                    <div className="mt-4 flex gap-0.5" aria-label={`${tm.rating} sur 5`}>
                      {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < tm.rating! ? "fill-champagne text-champagne" : "text-white/20"}`} />)}
                    </div>
                  )}
                  <blockquote className="mt-4 flex-1 leading-relaxed text-white/85">{tm.content}</blockquote>
                  <figcaption className="mt-6 text-sm"><span className="font-semibold">{tm.authorName}</span>{tm.authorRole && <span className="text-white/50"> — {tm.authorRole}</span>}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      {faqs.length > 0 && (
        <section className="container grid gap-10 py-16 lg:grid-cols-12 lg:py-24">
          <div className="lg:col-span-4">
            <SectionHeading label={t("home.faq.eyebrow")} title={t("home.faq.title")} />
            <Link href="/faq" className={buttonVariants({ variant: "outline", className: "mt-8" })}>{t("home.faq.more")}</Link>
          </div>
          <div className="divide-y divide-night/10 border-y border-night/10 lg:col-span-8">
            {faqs.map((f) => (
              <details key={f.id} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-lg font-semibold [&::-webkit-details-marker]:hidden">
                  {f.question}
                  <Plus className="h-5 w-5 shrink-0 text-ink-faint transition group-open:rotate-45" />
                </summary>
                <p className="mt-3 max-w-2xl leading-relaxed text-ink-soft">{f.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="container">
        <div className="relative overflow-hidden rounded-[32px] bg-teal px-7 py-14 sm:px-14 lg:py-20">
          <svg className="pointer-events-none absolute -right-10 bottom-0 h-full w-1/2 opacity-30" viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden>
            <path d="M0 20 C 90 40, 160 110, 300 190" fill="none" stroke="#101C35" strokeWidth="2" />
            <path d="M0 60 C 90 80, 160 140, 300 200" fill="none" stroke="#101C35" strokeWidth="1" />
          </svg>
          <div className="relative max-w-2xl">
            <h2 className="text-3xl font-extrabold leading-tight text-night sm:text-[2.75rem]">{t("home.cta.title")}</h2>
            <p className="mt-4 text-lg text-night/75">{t("home.cta.text")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/demande" className={buttonVariants({ size: "lg" })}>{t("nav.apply")}</Link>
              <Link href="/simulateur" className={buttonVariants({ size: "lg", variant: "light" })}>{t("home.hero.ctaSecondary")}</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
