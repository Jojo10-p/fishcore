import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PageHero } from "@/components/site/page-hero";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/server/settings";
import { initials } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "À propos" };

export default async function AboutPage() {
  const [{ t }, settings] = await Promise.all([getI18n(), getSettings()]);
  const values = [1, 2, 3, 4] as const;
  const team = settings.about.team.filter((m) => m.name);
  return (
    <>
      <PageHero label={t("about.eyebrow")} title={t("about.title")} text={t("about.intro")} />
      <section className="container grid gap-6 py-10 md:grid-cols-2">
        <div className="rounded-[28px] bg-night p-8 text-white sm:p-10">
          <h2 className="text-sm font-semibold text-champagne">{t("about.mission.title")}</h2>
          <p className="mt-4 font-display text-2xl font-semibold leading-snug">{t("about.mission.text")}</p>
        </div>
        <div className="rounded-[28px] border border-night/[.08] bg-white p-8 sm:p-10">
          <h2 className="text-sm font-semibold text-teal-700">{t("about.vision.title")}</h2>
          <p className="mt-4 font-display text-2xl font-semibold leading-snug">{t("about.vision.text")}</p>
        </div>
      </section>
      <section className="container grid gap-10 py-16 lg:grid-cols-12">
        <h2 className="text-3xl font-bold lg:col-span-4">{t("about.values.title")}</h2>
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-night/10 bg-night/10 sm:grid-cols-2 lg:col-span-8">
          {values.map((k) => (
            <li key={k} className="bg-paper p-7 font-display text-xl font-semibold">{t(`about.values.${k}`)}</li>
          ))}
        </ul>
      </section>
      <section className="container grid gap-10 py-10 lg:grid-cols-12">
        <h2 className="text-3xl font-bold lg:col-span-4">{t("about.how.title")}</h2>
        <div className="lg:col-span-8">
          <p className="text-lg leading-relaxed text-ink-soft">{t("about.how.text")}</p>
          {settings.compliance.licensed && settings.compliance.licenseNumber && (
            <p className="mt-6 rounded-2xl bg-teal-50 p-5 text-sm text-teal-700">Établissement agréé — {settings.compliance.regulator}, n° {settings.compliance.licenseNumber}.</p>
          )}
          <Link href="/contact" className={buttonVariants({ variant: "outline", className: "mt-8" })}>{t("nav.contact")}</Link>
        </div>
      </section>
      {team.length > 0 && (
        <section className="container py-16">
          <h2 className="text-3xl font-bold">{t("about.team.title")}</h2>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {team.map((m) => (
              <li key={m.name} className="rounded-2xl border border-night/[.08] bg-white p-6">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate2 font-display font-bold text-white">{initials(...(m.name.split(" ") as [string, string]))}</span>
                <p className="mt-5 font-display text-lg font-bold">{m.name}</p>
                <p className="text-sm text-ink-soft">{m.role}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
