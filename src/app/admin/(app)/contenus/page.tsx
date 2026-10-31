import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { ActionForm } from "@/components/forms/action-form";
import { Textarea } from "@/components/ui/field";
import { MediaUploader } from "@/components/admin/media-uploader";
import { saveTranslations } from "@/server/actions/admin/manage";
import { EDITABLE_KEYS, LOCALES, STATIC_DICTIONARIES, type Locale } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contenus du site" };

const GROUPS: [string, string][] = [["home.hero", "Accueil — section principale"], ["home.solutions", "Accueil — solutions"], ["home.simulator", "Accueil — simulateur"], ["home.process", "Accueil — fonctionnement"], ["home.advantages", "Accueil — engagements"], ["home.testimonials", "Accueil — témoignages"], ["home.faq", "Accueil — FAQ"], ["home.cta", "Accueil — appel à l'action"], ["home.stats", "Accueil — indicateurs"], ["about", "Page À propos"], ["footer", "Pied de page"], ["contact", "Page Contact"], ["solutions", "Page Solutions"], ["simulator", "Simulateur"]];

export default async function AdminContent({ searchParams }: { searchParams: Promise<{ langue?: string }> }) {
  const sp = await searchParams;
  await requireStaff("content.manage");
  const locale: Locale = (LOCALES as readonly string[]).includes(sp.langue ?? "") ? (sp.langue as Locale) : "fr";
  const overrides = await db.translation.findMany({ where: { locale } });
  const value = (k: string) => overrides.find((o) => o.key === k)?.value ?? "";
  const grouped = GROUPS.map(([prefix, label]) => ({ label, keys: EDITABLE_KEYS.filter((k) => k.startsWith(prefix + ".") && !GROUPS.some(([p]) => p !== prefix && p.startsWith(prefix + ".") && k.startsWith(p + "."))) })).filter((g) => g.keys.length);
  return (
    <>
      <PageHeader title="Contenus du site" text="Laissez un champ vide pour conserver le texte par défaut (affiché en gris). Les modifications sont publiées immédiatement." />
      <div className="mb-6 flex gap-2" role="tablist">
        {LOCALES.map((l) => <Link key={l} href={`/admin/contenus?langue=${l}`} role="tab" aria-selected={l === locale} className={cn("rounded-full px-4 py-2 text-sm font-medium", l === locale ? "bg-night text-white" : "bg-white text-ink-soft hover:text-ink")}>{l === "fr" ? "Français" : "English"}</Link>)}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <ActionForm action={saveTranslations} submitLabel="Publier les contenus" className="space-y-6">
          <input type="hidden" name="locale" value={locale} />
          {grouped.map((g) => (
            <section key={g.label} className="rounded-2xl border border-night/[.07] bg-white p-6">
              <h2 className="mb-4 font-display text-lg font-bold">{g.label}</h2>
              <div className="space-y-4">
                {g.keys.map((k) => {
                  const def = STATIC_DICTIONARIES[locale][k];
                  return (
                    <div key={k}>
                      <label htmlFor={k} className="mb-1 block font-mono text-xs text-ink-faint">{k}</label>
                      <Textarea id={k} name={`k:${k}`} defaultValue={value(k)} placeholder={def} rows={def.length > 90 ? 3 : 1} className={def.length > 90 ? "" : "min-h-0 py-2.5"} />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </ActionForm>
        <aside className="space-y-6">
          <div className="sticky top-24 rounded-2xl border border-night/[.07] bg-white p-6">
            <h2 className="mb-2 font-display text-lg font-bold">Images et bannières</h2>
            <p className="mb-4 text-sm text-ink-soft">Téléversez une image (PNG, JPG, WEBP) pour obtenir son adresse, à utiliser pour le logo ou l'image de partage (Paramètres).</p>
            <MediaUploader />
          </div>
        </aside>
      </div>
    </>
  );
}
