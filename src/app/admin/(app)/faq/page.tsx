import { Pencil, Trash2, HelpCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { FormDialog } from "@/components/admin/form-dialog";
import { ActionButton } from "@/components/admin/small-actions";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/surface";
import { saveFaq, deleteFaq } from "@/server/actions/admin/manage";
import { LOCALES } from "@/lib/i18n/dictionaries";

export const metadata = { title: "FAQ" };

type Row = { id?: string; category: string; question: string; answer: string; locale: string; sortOrder: number; isPublished: boolean };
function FaqFields({ f }: { f: Row }) {
  return (
    <>
      {f.id && <input type="hidden" name="id" value={f.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Catégorie" htmlFor="category" className="sm:col-span-2"><Input id="category" name="category" defaultValue={f.category} required /></Field>
        <Field label="Langue" htmlFor="locale"><Select id="locale" name="locale" defaultValue={f.locale}>{LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</Select></Field>
      </div>
      <Field label="Question" htmlFor="question"><Input id="question" name="question" defaultValue={f.question} required /></Field>
      <Field label="Réponse" htmlFor="answer"><Textarea id="answer" name="answer" rows={6} defaultValue={f.answer} required /></Field>
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm"><Checkbox name="isPublished" defaultChecked={f.isPublished} />Publiée</label>
        <Field label="Ordre" htmlFor="sortOrder"><Input id="sortOrder" name="sortOrder" type="number" min={0} defaultValue={f.sortOrder} className="w-24" /></Field>
      </div>
    </>
  );
}

export default async function AdminFaq() {
  await requireStaff("faq.manage");
  const rows = await db.faq.findMany({ orderBy: [{ locale: "asc" }, { category: "asc" }, { sortOrder: "asc" }] });
  return (
    <>
      <PageHeader title="FAQ" text="Questions affichées sur la page FAQ et l'accueil, regroupées par catégorie." actions={<FormDialog trigger="Nouvelle question" triggerProps={{ size: "sm" }} title="Nouvelle question" action={saveFaq} wide><FaqFields f={{ category: "", question: "", answer: "", locale: "fr", sortOrder: 0, isPublished: true }} /></FormDialog>} />
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {rows.length === 0 ? <EmptyState icon={<HelpCircle className="h-5 w-5" />} title="Aucune question" /> : (
          <ul className="divide-y divide-night/[.06]">
            {rows.map((f) => (
              <li key={f.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{f.question}</p>
                  <p className="text-sm text-ink-faint">{f.category} · {f.locale.toUpperCase()} · ordre {f.sortOrder}</p>
                </div>
                <div className="flex items-center gap-2">
                  {f.isPublished ? <Badge tone="green">Publiée</Badge> : <Badge tone="slate">Masquée</Badge>}
                  <FormDialog trigger={<Pencil className="h-4 w-4" />} triggerProps={{ variant: "ghost", size: "icon", "aria-label": "Modifier" }} title="Modifier la question" action={saveFaq} wide><FaqFields f={f} /></FormDialog>
                  <ActionButton variant="ghost" size="icon" aria-label="Supprimer" run={deleteFaq.bind(null, f.id)} confirm={{ title: "Supprimer cette question ?", label: "Supprimer", danger: true }}><Trash2 className="h-4 w-4" /></ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
