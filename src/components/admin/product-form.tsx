"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { FormStatus, type ActionState } from "@/components/ui/form-status";
import { saveProduct } from "@/server/actions/admin/products";
import { CATEGORY_META, DOCUMENT_TYPES } from "@/lib/status";
import { simulate } from "@/lib/loan-math";

export interface ProductFormValues {
  id?: string; name: string; slug: string; category: string; tagline: string; description: string;
  minAmount: string; maxAmount: string; minDurationMonths: string; maxDurationMonths: string;
  annualRate: string; feesFixed: string; feesPercent: string; insuranceRate: string;
  eligibility: string; requiredDocuments: { key: string; label: string; required: boolean }[]; isActive: boolean; sortOrder: string;
}

export function ProductForm({ initial, currency, readOnly }: { initial: ProductFormValues; currency: string; readOnly?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProduct, undefined);
  const [v, setV] = useState(initial);
  useEffect(() => { if (state?.ok && state.message) toast.success(state.message); }, [state]);
  const e = state?.errors ?? {};
  const set = (k: keyof ProductFormValues) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: ev.target.value }));
  const docs = v.requiredDocuments;
  const setDocs = (d: ProductFormValues["requiredDocuments"]) => setV((s) => ({ ...s, requiredDocuments: d }));
  const preview = Number(v.minAmount) > 0 && Number(v.maxDurationMonths) > 0 && v.annualRate !== ""
    ? simulate({ amount: Number(v.minAmount), durationMonths: Number(v.minDurationMonths), annualRate: Number(v.annualRate), feesFixed: Number(v.feesFixed), feesPercent: Number(v.feesPercent), insuranceRate: Number(v.insuranceRate) })
    : null;
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);

  return (
    <form onSubmit={submitWith(action)} className="grid gap-6 xl:grid-cols-3">
      <fieldset disabled={readOnly} className="space-y-6 xl:col-span-2">
        {v.id && <input type="hidden" name="id" value={v.id} />}
        <input type="hidden" name="requiredDocuments" value={JSON.stringify(docs)} />
        {state && !state.ok && <FormStatus state={state} />}
        <section className="rounded-2xl border border-night/[.07] bg-white p-6">
          <h2 className="mb-5 font-display text-lg font-bold">Présentation</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Nom de l'offre" htmlFor="name" error={e.name} required><Input id="name" name="name" value={v.name} onChange={set("name")} /></Field>
            <Field label="Catégorie" htmlFor="category" required>
              <Select id="category" name="category" value={v.category} onChange={set("category")}>{Object.entries(CATEGORY_META).map(([k, m]) => <option key={k} value={k}>{m.fr}</option>)}</Select>
            </Field>
            <Field label="Accroche" htmlFor="tagline" error={e.tagline}><Input id="tagline" name="tagline" value={v.tagline} onChange={set("tagline")} /></Field>
            <Field label="Identifiant d'URL" htmlFor="slug" error={e.slug} hint="Généré depuis le nom si vide"><Input id="slug" name="slug" value={v.slug} onChange={set("slug")} /></Field>
            <Field label="Description" htmlFor="description" error={e.description} required className="sm:col-span-2"><Textarea id="description" name="description" rows={5} value={v.description} onChange={set("description")} /></Field>
          </div>
        </section>
        <section className="rounded-2xl border border-night/[.07] bg-white p-6">
          <h2 className="mb-1 font-display text-lg font-bold">Conditions commerciales</h2>
          <p className="mb-5 text-sm text-ink-soft">Ces valeurs sont publiées sur le site et utilisées par le simulateur. Elles doivent correspondre à vos conditions réelles et validées.</p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={`Montant min. (${currency})`} htmlFor="minAmount" error={e.minAmount} required><Input id="minAmount" name="minAmount" type="number" step="any" min={0} value={v.minAmount} onChange={set("minAmount")} /></Field>
            <Field label={`Montant max. (${currency})`} htmlFor="maxAmount" error={e.maxAmount} required><Input id="maxAmount" name="maxAmount" type="number" step="any" min={0} value={v.maxAmount} onChange={set("maxAmount")} /></Field>
            <Field label="Durée min. (mois)" htmlFor="minDurationMonths" error={e.minDurationMonths} required><Input id="minDurationMonths" name="minDurationMonths" type="number" min={1} value={v.minDurationMonths} onChange={set("minDurationMonths")} /></Field>
            <Field label="Durée max. (mois)" htmlFor="maxDurationMonths" error={e.maxDurationMonths} required><Input id="maxDurationMonths" name="maxDurationMonths" type="number" min={1} value={v.maxDurationMonths} onChange={set("maxDurationMonths")} /></Field>
            <Field label="Taux annuel (%)" htmlFor="annualRate" error={e.annualRate} required><Input id="annualRate" name="annualRate" type="number" step="0.001" min={0} value={v.annualRate} onChange={set("annualRate")} /></Field>
            <Field label={`Frais fixes (${currency})`} htmlFor="feesFixed" error={e.feesFixed}><Input id="feesFixed" name="feesFixed" type="number" step="any" min={0} value={v.feesFixed} onChange={set("feesFixed")} /></Field>
            <Field label="Frais (% du capital)" htmlFor="feesPercent" error={e.feesPercent}><Input id="feesPercent" name="feesPercent" type="number" step="0.001" min={0} value={v.feesPercent} onChange={set("feesPercent")} /></Field>
            <Field label="Assurance (%/an)" htmlFor="insuranceRate" error={e.insuranceRate}><Input id="insuranceRate" name="insuranceRate" type="number" step="0.001" min={0} value={v.insuranceRate} onChange={set("insuranceRate")} /></Field>
          </div>
        </section>
        <section className="rounded-2xl border border-night/[.07] bg-white p-6">
          <h2 className="mb-5 font-display text-lg font-bold">Éligibilité et pièces</h2>
          <Field label="Conditions d'éligibilité" htmlFor="eligibility" hint="Une condition par ligne"><Textarea id="eligibility" name="eligibility" rows={4} value={v.eligibility} onChange={set("eligibility")} /></Field>
          <div className="mt-6">
            <p className="mb-2 text-sm font-medium">Documents requis</p>
            {e.requiredDocuments && <p className="mb-2 text-[13px] text-[#C93B3B]">{e.requiredDocuments[0]}</p>}
            <ul className="space-y-2">
              {docs.map((d, i) => (
                <li key={i} className="grid gap-2 rounded-xl bg-paper p-3 sm:grid-cols-[180px_1fr_auto_auto] sm:items-center">
                  <Select aria-label="Type" value={d.key} onChange={(ev) => setDocs(docs.map((x, j) => (j === i ? { ...x, key: ev.target.value, label: x.label || DOCUMENT_TYPES[ev.target.value] } : x)))}>
                    {Object.entries(DOCUMENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                  <Input aria-label="Intitulé affiché" value={d.label} onChange={(ev) => setDocs(docs.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} />
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={d.required} onChange={(ev) => setDocs(docs.map((x, j) => (j === i ? { ...x, required: ev.target.checked } : x)))} />Requis</label>
                  <button type="button" onClick={() => setDocs(docs.filter((_, j) => j !== i))} className="justify-self-end rounded-lg p-2 text-ink-faint hover:bg-white hover:text-[#B03030]" aria-label="Retirer"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setDocs([...docs, { key: "identity", label: DOCUMENT_TYPES.identity, required: true }])}><Plus className="h-4 w-4" />Ajouter un document</Button>
          </div>
        </section>
      </fieldset>
      <aside className="space-y-6">
        <section className="sticky top-24 space-y-5 rounded-2xl border border-night/[.07] bg-white p-6">
          <label className="flex items-start gap-3">
            <Checkbox name="isActive" checked={v.isActive} disabled={readOnly} onChange={(ev) => setV((s) => ({ ...s, isActive: ev.target.checked }))} className="mt-0.5" />
            <span><span className="block font-medium">Offre publiée</span><span className="text-sm text-ink-soft">Visible sur le site, le simulateur et le formulaire de demande.</span></span>
          </label>
          <Field label="Ordre d'affichage" htmlFor="sortOrder"><Input id="sortOrder" name="sortOrder" type="number" min={0} value={v.sortOrder} onChange={set("sortOrder")} disabled={readOnly} /></Field>
          {preview && (
            <div className="rounded-xl bg-paper p-4 text-sm">
              <p className="font-medium">Contrôle rapide</p>
              <p className="mt-1 text-ink-soft">Pour {fmt(Number(v.minAmount))} sur {v.minDurationMonths} mois : mensualité {fmt(preview.monthlyTotal)}, coût total {fmt(preview.totalCost)}.</p>
            </div>
          )}
          {!readOnly && <Button type="submit" loading={pending} className="w-full">Enregistrer l'offre</Button>}
        </section>
      </aside>
    </form>
  );
}
