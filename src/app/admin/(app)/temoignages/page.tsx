import { Pencil, Trash2, Quote, ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { FormDialog } from "@/components/admin/form-dialog";
import { ActionButton } from "@/components/admin/small-actions";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/surface";
import { saveTestimonial, deleteTestimonial } from "@/server/actions/admin/manage";
import { LOCALES } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Témoignages" };

type Row = { id?: string; authorName: string; authorRole: string | null; content: string; rating: number | null; consentObtained: boolean; consentDate: Date | null; isPublished: boolean; locale: string; sortOrder: number };
function Fields({ t }: { t: Row }) {
  return (
    <>
      {t.id && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom affiché" htmlFor="authorName" hint="Prénom + initiale si l'auteur le souhaite"><Input id="authorName" name="authorName" defaultValue={t.authorName} required /></Field>
        <Field label="Profil / contexte" htmlFor="authorRole"><Input id="authorRole" name="authorRole" defaultValue={t.authorRole ?? ""} /></Field>
      </div>
      <Field label="Témoignage (texte exact validé par l'auteur)" htmlFor="content"><Textarea id="content" name="content" rows={5} defaultValue={t.content} required /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Note (1–5)" htmlFor="rating"><Input id="rating" name="rating" type="number" min={1} max={5} defaultValue={t.rating ?? ""} /></Field>
        <Field label="Langue" htmlFor="locale"><Select id="locale" name="locale" defaultValue={t.locale}>{LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</Select></Field>
        <Field label="Ordre" htmlFor="sortOrder"><Input id="sortOrder" name="sortOrder" type="number" min={0} defaultValue={t.sortOrder} /></Field>
      </div>
      <div className="space-y-3 rounded-xl bg-paper p-4">
        <label className="flex items-start gap-2 text-sm"><Checkbox name="consentObtained" defaultChecked={t.consentObtained} className="mt-0.5" />Je confirme que l'auteur est un client réel et a donné son accord écrit pour la publication.</label>
        <Field label="Date du consentement" htmlFor="consentDate"><Input id="consentDate" name="consentDate" type="date" defaultValue={t.consentDate ? t.consentDate.toISOString().slice(0, 10) : ""} /></Field>
        <label className="flex items-center gap-2 text-sm font-medium"><Checkbox name="isPublished" defaultChecked={t.isPublished} />Publier sur le site</label>
      </div>
    </>
  );
}

export default async function AdminTestimonials() {
  await requireStaff("testimonials.manage");
  const rows = await db.testimonial.findMany({ orderBy: [{ isPublished: "desc" }, { sortOrder: "asc" }] });
  return (
    <>
      <PageHeader title="Témoignages" text="Seuls les témoignages authentiques, dont le consentement est enregistré et daté, peuvent être publiés." actions={<FormDialog trigger="Ajouter un témoignage" triggerProps={{ size: "sm" }} title="Nouveau témoignage" action={saveTestimonial} wide><Fields t={{ authorName: "", authorRole: "", content: "", rating: null, consentObtained: false, consentDate: null, isPublished: false, locale: "fr", sortOrder: 0 }} /></FormDialog>} />
      <p className="mb-6 flex gap-2 rounded-xl bg-champagne-50 p-4 text-sm text-champagne-700"><ShieldAlert className="h-5 w-5 shrink-0" />La publication de faux avis ou d'avis non autorisés est une pratique commerciale trompeuse. Conservez la preuve du consentement de chaque auteur.</p>
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {rows.length === 0 ? <EmptyState icon={<Quote className="h-5 w-5" />} title="Aucun témoignage" text="La section Témoignages de l'accueil reste masquée tant qu'aucun témoignage n'est publié." /> : (
          <ul className="divide-y divide-night/[.06]">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1"><p className="line-clamp-2">« {t.content} »</p><p className="mt-1 text-sm text-ink-faint">{t.authorName}{t.authorRole && ` — ${t.authorRole}`} · {t.locale.toUpperCase()} · consentement {t.consentObtained ? `du ${formatDate(t.consentDate)}` : "non enregistré"}</p></div>
                <div className="flex items-center gap-2">
                  {t.isPublished ? <Badge tone="green">Publié</Badge> : <Badge tone="slate">Non publié</Badge>}
                  <FormDialog trigger={<Pencil className="h-4 w-4" />} triggerProps={{ variant: "ghost", size: "icon", "aria-label": "Modifier" }} title="Modifier le témoignage" action={saveTestimonial} wide><Fields t={t} /></FormDialog>
                  <ActionButton variant="ghost" size="icon" aria-label="Supprimer" run={deleteTestimonial.bind(null, t.id)} confirm={{ title: "Supprimer ce témoignage ?", label: "Supprimer", danger: true }}><Trash2 className="h-4 w-4" /></ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
