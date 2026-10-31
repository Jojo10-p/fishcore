import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { PageHero } from "@/components/site/page-hero";
import { getI18n } from "@/lib/i18n/server";
import { getPublishedFaqs } from "@/server/services/public";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FAQ" };

export default async function FaqPage() {
  const { t, locale } = await getI18n();
  const faqs = await getPublishedFaqs(locale);
  const groups = faqs.reduce<Record<string, typeof faqs>>((acc, f) => ((acc[f.category] ??= []).push(f), acc), {});
  const cats = Object.keys(groups);
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) };
  return (
    <>
      <PageHero label={t("nav.faq")} title={t("faq.title")} text={t("faq.subtitle")} />
      <div className="container grid gap-10 lg:grid-cols-12">
        {cats.length === 0 && <p className="text-ink-soft lg:col-span-12">{t("faq.empty")}</p>}
        {cats.length > 1 && (
          <nav className="lg:col-span-3" aria-label="Catégories">
            <ul className="flex gap-2 overflow-x-auto lg:sticky lg:top-28 lg:flex-col">
              {cats.map((c) => <li key={c}><a href={`#cat-${c}`} className="block whitespace-nowrap rounded-full px-4 py-2 text-ink-soft hover:bg-mist hover:text-ink">{c}</a></li>)}
            </ul>
          </nav>
        )}
        <div className={cats.length > 1 ? "space-y-12 lg:col-span-9" : "space-y-12 lg:col-span-12"}>
          {cats.map((c) => (
            <section key={c} id={`cat-${c}`} className="scroll-mt-28">
              <h2 className="mb-4 text-2xl font-bold">{c}</h2>
              <div className="divide-y divide-night/10 border-y border-night/10">
                {groups[c].map((f) => (
                  <details key={f.id} className="group py-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-lg font-semibold [&::-webkit-details-marker]:hidden">
                      {f.question}
                      <Plus className="h-5 w-5 shrink-0 text-ink-faint transition group-open:rotate-45" />
                    </summary>
                    <p className="mt-3 max-w-2xl whitespace-pre-line leading-relaxed text-ink-soft">{f.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
