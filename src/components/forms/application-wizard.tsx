"use client";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, FileUp, Trash2, AlertTriangle, ShieldCheck, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/field";
import { FormStatus } from "@/components/ui/form-status";
import { cn, formatBytes } from "@/lib/utils";
import { simulate } from "@/lib/loan-math";
import { identitySchema, professionalSchema, financingSchema, checkProductBounds, EMPLOYMENT_STATUSES } from "@/lib/validation/application";
import { submitApplication, type SubmitState } from "@/server/actions/application";
import type { PublicProduct } from "@/server/services/public";

const STEPS = ["Identité", "Situation professionnelle", "Financement", "Documents", "Validation"];
const DRAFT_KEY = "aurane.apply.draft.v1";
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MAX = 8 * 1024 * 1024;

type Values = Record<string, string>;

interface Props {
  products: PublicProduct[];
  currency: string;
  numberLocale: string;
  isLogged: boolean;
  prefill: Values;
  initial: { productSlug?: string; amount?: string; duration?: string };
}

export function ApplicationWizard({ products, currency, numberLocale, isLogged, prefill, initial }: Props) {
  const initialProduct = products.find((p) => p.slug === initial.productSlug) ?? products[0];
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [values, setValues] = useState<Values>(() => ({
    country: "",
    employmentStatus: "",
    monthlyCharges: "0",
    ...prefill,
    productId: initialProduct?.id ?? "",
    amount: initial.amount ?? String(initialProduct ? Math.round((initialProduct.minAmount + initialProduct.maxAmount) / 4 / 100) * 100 : ""),
    durationMonths: initial.duration ?? String(initialProduct ? Math.round((initialProduct.minDurationMonths + initialProduct.maxDurationMonths) / 2) : ""),
  }));
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [restored, setRestored] = useState(false);
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(submitApplication, undefined);
  const topRef = useRef<HTMLDivElement>(null);

  // Brouillon local (hors fichiers et mot de passe)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Values;
        setValues((v) => ({ ...draft, ...Object.fromEntries(Object.entries(prefill).filter(([, x]) => x)), ...(initial.productSlug ? { productId: v.productId, amount: v.amount, durationMonths: v.durationMonths } : {}) }));
        setRestored(true);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      const { password: _p, passwordConfirm: _c, acceptTerms: _a, acceptData: _d, ...rest } = values;
      void _p; void _c; void _a; void _d;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
    } catch {}
  }, [values]);

  // Erreurs renvoyées par le serveur
  useEffect(() => {
    if (!state) return;
    const errs = Object.fromEntries(Object.entries(state.errors ?? {}).map(([k, v]) => [k, v?.[0]]));
    setErrors(errs);
    if (typeof state.step === "number") go(state.step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const product = products.find((p) => p.id === values.productId);
  const sim = useMemo(() => {
    if (!product) return null;
    const a = Number(values.amount);
    const d = Number(values.durationMonths);
    if (!a || !d) return null;
    return simulate({ amount: a, durationMonths: d, annualRate: product.annualRate, feesFixed: product.feesFixed, feesPercent: product.feesPercent, insuranceRate: product.insuranceRate });
  }, [product, values.amount, values.durationMonths]);
  const money = (n: number, d = 0) => new Intl.NumberFormat(numberLocale, { style: "currency", currency, maximumFractionDigits: d, minimumFractionDigits: d }).format(n);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === "checkbox" ? ((e.target as HTMLInputElement).checked ? "on" : "") : e.target.value;
    setValues((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  function go(n: number) {
    setDir(n > step ? 1 : -1);
    setStep(n);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function validate(s: number): boolean {
    let errs: Record<string, string | undefined> = {};
    const pick = (schema: typeof identitySchema | typeof professionalSchema | typeof financingSchema) => {
      const r = schema.safeParse(values);
      if (!r.success) errs = Object.fromEntries(Object.entries(r.error.flatten().fieldErrors).map(([k, v]) => [k, (v as string[] | undefined)?.[0]]));
    };
    if (s === 0) pick(identitySchema);
    if (s === 1) pick(professionalSchema);
    if (s === 2) {
      pick(financingSchema);
      if (product) errs = { ...errs, ...checkProductBounds(product, Number(values.amount), Number(values.durationMonths)) };
    }
    if (s === 3) {
      for (const list of Object.values(files)) for (const f of list) if (f.size > MAX) errs.files = `« ${f.name} » dépasse 8 Mo.`;
    }
    if (s === 4) {
      if (!isLogged) {
        const pw = values.password ?? "";
        if (pw.length < 10 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) errs.password = "10 caractères minimum, avec majuscule, minuscule et chiffre";
        if (pw !== values.passwordConfirm) errs.passwordConfirm = "Les mots de passe ne correspondent pas";
      }
      if (values.acceptTerms !== "on") errs.acceptTerms = "Vous devez accepter les conditions";
      if (values.acceptData !== "on") errs.acceptData = "Votre consentement est nécessaire";
    }
    setErrors(errs);
    const first = Object.keys(errs).find((k) => errs[k]);
    if (first) document.getElementById(first)?.focus();
    return !first;
  }

  function next() {
    if (validate(step)) go(step + 1);
  }

  function submit() {
    if (!validate(4)) return;
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.append(k, v);
    for (const [k, list] of Object.entries(files)) for (const f of list) fd.append(`doc_${k}`, f);
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    startTransition(() => formAction(fd));
  }

  const addFiles = (key: string, multiple: boolean) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    const bad = list.find((f) => f.size > MAX || !ACCEPT.split(",").includes(f.type));
    if (bad) { setErrors((x) => ({ ...x, files: `« ${bad.name} » : format PDF/JPG/PNG/WEBP, 8 Mo maximum.` })); return; }
    setErrors((x) => ({ ...x, files: undefined }));
    setFiles((s) => ({ ...s, [key]: multiple ? [...(s[key] ?? []), ...list].slice(0, 4) : list.slice(0, 1) }));
  };
  const removeFile = (key: string, i: number) => setFiles((s) => ({ ...s, [key]: (s[key] ?? []).filter((_, j) => j !== i) }));

  const docSlots = [...(product?.requiredDocuments ?? []), { key: "other", label: "Documents complémentaires", required: false }];
  const missingRequired = (product?.requiredDocuments ?? []).filter((d) => d.required && !(files[d.key]?.length));
  const err = (k: string) => errors[k];

  return (
    <div ref={topRef} className="scroll-mt-28">
      {/* Progression */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-sm">
          <p className="font-semibold">Étape {step + 1} sur {STEPS.length} · {STEPS[step]}</p>
          <p className="tabular text-ink-faint">{Math.round(((step + 1) / STEPS.length) * 100)} %</p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
          <motion.div className="h-full rounded-full bg-teal" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.35 }} />
        </div>
        <ol className="mt-4 hidden grid-cols-5 gap-2 md:grid">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                disabled={i > step}
                onClick={() => i < step && go(i)}
                className={cn("flex w-full items-center gap-2 text-left text-[13px]", i === step ? "font-semibold text-ink" : i < step ? "text-teal-700 hover:underline" : "text-ink-faint")}
              >
                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px]", i < step ? "bg-teal text-white" : i === step ? "bg-night text-white" : "bg-mist")}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>
      </div>

      {restored && step === 0 && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl bg-teal-50 px-4 py-3 text-sm text-teal-700">
          <span>Votre saisie précédente a été restaurée.</span>
          <button type="button" className="font-semibold underline" onClick={() => { localStorage.removeItem(DRAFT_KEY); setValues({ ...prefill, productId: values.productId, amount: values.amount, durationMonths: values.durationMonths, monthlyCharges: "0" }); setRestored(false); }}>Repartir de zéro</button>
        </div>
      )}
      {state && !state.ok && <div className="mb-6"><FormStatus state={{ ok: false, message: state.message }} /></div>}

      <div className="rounded-[28px] border border-night/[.07] bg-white p-6 sm:p-10">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div key={step} custom={dir} initial={{ opacity: 0, x: dir * 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -24 }} transition={{ duration: 0.22 }}>
            {step === 0 && (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Nom" htmlFor="lastName" error={err("lastName")} required><Input id="lastName" autoComplete="family-name" value={values.lastName ?? ""} onChange={set("lastName")} aria-invalid={!!err("lastName")} /></Field>
                <Field label="Prénoms" htmlFor="firstName" error={err("firstName")} required><Input id="firstName" autoComplete="given-name" value={values.firstName ?? ""} onChange={set("firstName")} aria-invalid={!!err("firstName")} /></Field>
                <Field label="Date de naissance" htmlFor="birthDate" error={err("birthDate")} required><Input id="birthDate" type="date" autoComplete="bday" value={values.birthDate ?? ""} onChange={set("birthDate")} aria-invalid={!!err("birthDate")} /></Field>
                <Field label="Nationalité" htmlFor="nationality" error={err("nationality")}><Input id="nationality" value={values.nationality ?? ""} onChange={set("nationality")} /></Field>
                <Field label="Email" htmlFor="email" error={err("email")} required hint={isLogged ? "Email de votre compte" : undefined}><Input id="email" type="email" autoComplete="email" value={values.email ?? ""} onChange={set("email")} readOnly={isLogged} aria-invalid={!!err("email")} /></Field>
                <Field label="Téléphone" htmlFor="phone" error={err("phone")} required><Input id="phone" type="tel" autoComplete="tel" value={values.phone ?? ""} onChange={set("phone")} aria-invalid={!!err("phone")} /></Field>
                <Field label="Pays" htmlFor="country" error={err("country")} required><Input id="country" autoComplete="country-name" value={values.country ?? ""} onChange={set("country")} aria-invalid={!!err("country")} /></Field>
                <Field label="Ville" htmlFor="city" error={err("city")} required><Input id="city" autoComplete="address-level2" value={values.city ?? ""} onChange={set("city")} aria-invalid={!!err("city")} /></Field>
                <Field label="Adresse" htmlFor="address" error={err("address")} required className="sm:col-span-2"><Input id="address" autoComplete="street-address" value={values.address ?? ""} onChange={set("address")} aria-invalid={!!err("address")} /></Field>
                {!isLogged && err("email")?.includes("connectez") && (
                  <Link href="/connexion?next=/demande" className="flex items-center gap-2 text-sm font-semibold text-teal-700 sm:col-span-2"><LogIn className="h-4 w-4" />Se connecter à mon espace</Link>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Profession" htmlFor="profession" error={err("profession")} required><Input id="profession" autoComplete="organization-title" value={values.profession ?? ""} onChange={set("profession")} aria-invalid={!!err("profession")} /></Field>
                <Field label="Situation professionnelle" htmlFor="employmentStatus" error={err("employmentStatus")} required>
                  <Select id="employmentStatus" value={values.employmentStatus ?? ""} onChange={set("employmentStatus")} aria-invalid={!!err("employmentStatus")}>
                    <option value="">Sélectionner…</option>
                    {EMPLOYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
                <Field label="Employeur ou entreprise" htmlFor="employer" hint="Si applicable" className="sm:col-span-2"><Input id="employer" autoComplete="organization" value={values.employer ?? ""} onChange={set("employer")} /></Field>
                <Field label={`Revenus mensuels nets (${currency})`} htmlFor="monthlyIncome" error={err("monthlyIncome")} required><Input id="monthlyIncome" type="number" inputMode="decimal" min={0} value={values.monthlyIncome ?? ""} onChange={set("monthlyIncome")} aria-invalid={!!err("monthlyIncome")} /></Field>
                <Field label={`Charges mensuelles (${currency})`} htmlFor="monthlyCharges" error={err("monthlyCharges")} hint="Loyer, crédits en cours, pensions…" required><Input id="monthlyCharges" type="number" inputMode="decimal" min={0} value={values.monthlyCharges ?? ""} onChange={set("monthlyCharges")} aria-invalid={!!err("monthlyCharges")} /></Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <fieldset>
                  <legend className="mb-3 text-sm font-medium">Catégorie de financement <span className="text-champagne-700">*</span></legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {products.map((p) => (
                      <label key={p.id} className={cn("flex cursor-pointer flex-col rounded-2xl border p-4 transition", values.productId === p.id ? "border-night bg-night text-white" : "border-night/12 hover:border-night/35")}>
                        <input type="radio" name="productId" value={p.id} checked={values.productId === p.id} onChange={set("productId")} className="sr-only" />
                        <span className="font-display font-bold">{p.name}</span>
                        <span className={cn("tabular mt-1 text-[13px]", values.productId === p.id ? "text-white/65" : "text-ink-soft")}>{money(p.minAmount)} – {money(p.maxAmount)} · {p.annualRate.toLocaleString(numberLocale)} %</span>
                      </label>
                    ))}
                  </div>
                  {err("productId") && <p className="mt-1.5 text-[13px] text-[#C93B3B]">{err("productId")}</p>}
                </fieldset>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label={`Montant demandé (${currency})`} htmlFor="amount" error={err("amount")} required hint={product ? `De ${money(product.minAmount)} à ${money(product.maxAmount)}` : undefined}><Input id="amount" type="number" inputMode="numeric" value={values.amount ?? ""} onChange={set("amount")} aria-invalid={!!err("amount")} /></Field>
                  <Field label="Durée souhaitée (mois)" htmlFor="durationMonths" error={err("durationMonths")} required hint={product ? `De ${product.minDurationMonths} à ${product.maxDurationMonths} mois` : undefined}><Input id="durationMonths" type="number" inputMode="numeric" value={values.durationMonths ?? ""} onChange={set("durationMonths")} aria-invalid={!!err("durationMonths")} /></Field>
                </div>
                {sim && !err("amount") && !err("durationMonths") && (
                  <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-paper px-5 py-4">
                    <span className="text-sm text-ink-soft">Mensualité estimée (indicative)</span>
                    <span className="tabular font-display text-2xl font-bold">{money(sim.monthlyTotal, 2)}</span>
                    <span className="w-full text-xs text-ink-faint">Coût total estimé : {money(sim.totalCost, 2)} — simulation sans valeur d'offre de crédit.</span>
                  </div>
                )}
                <Field label="Objet du financement" htmlFor="purpose" error={err("purpose")} required><Input id="purpose" placeholder="Ex. : achat d'un véhicule, besoin de trésorerie…" value={values.purpose ?? ""} onChange={set("purpose")} aria-invalid={!!err("purpose")} /></Field>
                <Field label="Description du projet" htmlFor="description" error={err("description")} required><Textarea id="description" rows={5} value={values.description ?? ""} onChange={set("description")} aria-invalid={!!err("description")} /></Field>
              </div>
            )}

            {step === 3 && (
              <div>
                <p className="mb-6 flex gap-2 text-sm text-ink-soft"><ShieldCheck className="h-5 w-5 shrink-0 text-teal" />Vos documents sont chiffrés en transit et stockés dans un espace privé, consultable uniquement par vous et les analystes habilités. PDF, JPG, PNG ou WEBP — 8 Mo max par fichier.</p>
                {err("files") && <p role="alert" className="mb-4 text-sm text-[#C93B3B]">{err("files")}</p>}
                <ul className="space-y-3">
                  {docSlots.map((d) => {
                    const multiple = d.key === "other";
                    const list = files[d.key] ?? [];
                    return (
                      <li key={d.key} className="rounded-2xl border border-night/10 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">{d.label}</p>
                            <p className="text-[13px] text-ink-faint">{d.required ? "Requis — peut être transmis plus tard" : "Facultatif"}</p>
                          </div>
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-night/15 px-4 py-2 text-sm font-medium hover:border-night/40 focus-within:ring-4 focus-within:ring-teal/20">
                            <FileUp className="h-4 w-4" />{list.length && !multiple ? "Remplacer" : "Ajouter"}
                            <input type="file" accept={ACCEPT} multiple={multiple} className="sr-only" onChange={addFiles(d.key, multiple)} aria-label={`Téléverser : ${d.label}`} />
                          </label>
                        </div>
                        {list.length > 0 && (
                          <ul className="mt-3 space-y-2">
                            {list.map((f, i) => (
                              <li key={f.name + i} className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2 text-sm">
                                <span className="flex min-w-0 items-center gap-2"><Check className="h-4 w-4 shrink-0 text-teal" /><span className="truncate">{f.name}</span><span className="shrink-0 text-ink-faint">{formatBytes(f.size)}</span></span>
                                <button type="button" onClick={() => removeFile(d.key, i)} className="rounded-full p-1 text-ink-faint hover:bg-mist hover:text-[#C93B3B]" aria-label={`Retirer ${f.name}`}><Trash2 className="h-4 w-4" /></button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-8">
                <div className="grid gap-6 md:grid-cols-3">
                  <Recap title="Identité" onEdit={() => go(0)} rows={[["Nom", `${values.firstName ?? ""} ${values.lastName ?? ""}`], ["Email", values.email], ["Téléphone", values.phone], ["Ville", `${values.city ?? ""}, ${values.country ?? ""}`]]} />
                  <Recap title="Situation" onEdit={() => go(1)} rows={[["Profession", values.profession], ["Statut", values.employmentStatus], ["Revenus", money(Number(values.monthlyIncome) || 0)], ["Charges", money(Number(values.monthlyCharges) || 0)]]} />
                  <Recap title="Financement" onEdit={() => go(2)} rows={[["Offre", product?.name], ["Montant", money(Number(values.amount) || 0)], ["Durée", `${values.durationMonths} mois`], ["Mensualité estimée", sim ? money(sim.monthlyTotal, 2) : "—"]]} />
                </div>
                {missingRequired.length > 0 && (
                  <div className="flex gap-3 rounded-2xl bg-[#FDF3E2] p-4 text-sm text-[#7A4F0E]">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <p>Justificatifs non joints : {missingRequired.map((m) => m.label).join(", ")}. Votre demande sera enregistrée, mais son étude commencera dès réception de ces pièces depuis votre espace.</p>
                  </div>
                )}
                {!isLogged && (
                  <div>
                    <p className="font-display text-lg font-bold">Créez votre espace de suivi</p>
                    <p className="mt-1 text-sm text-ink-soft">Il vous permettra de suivre votre dossier et de transmettre des pièces. Identifiant : {values.email}</p>
                    <div className="mt-4 grid gap-5 sm:grid-cols-2">
                      <Field label="Mot de passe" htmlFor="password" error={err("password")} hint="10 caractères min., majuscule, minuscule et chiffre" required><Input id="password" type="password" autoComplete="new-password" value={values.password ?? ""} onChange={set("password")} aria-invalid={!!err("password")} /></Field>
                      <Field label="Confirmation" htmlFor="passwordConfirm" error={err("passwordConfirm")} required><Input id="passwordConfirm" type="password" autoComplete="new-password" value={values.passwordConfirm ?? ""} onChange={set("passwordConfirm")} aria-invalid={!!err("passwordConfirm")} /></Field>
                    </div>
                  </div>
                )}
                <div className="space-y-4">
                  <label className="flex gap-3 text-sm leading-relaxed">
                    <Checkbox id="acceptTerms" checked={values.acceptTerms === "on"} onChange={set("acceptTerms")} aria-invalid={!!err("acceptTerms")} />
                    <span>J'ai lu et j'accepte les <Link href="/conditions" target="_blank" className="font-semibold text-teal-700 underline">conditions générales</Link>. Je certifie l'exactitude des informations fournies et je comprends que la simulation ne constitue pas une offre de crédit.{err("acceptTerms") && <span className="block text-[#C93B3B]">{err("acceptTerms")}</span>}</span>
                  </label>
                  <label className="flex gap-3 text-sm leading-relaxed">
                    <Checkbox id="acceptData" checked={values.acceptData === "on"} onChange={set("acceptData")} aria-invalid={!!err("acceptData")} />
                    <span>J'accepte que mes données personnelles et justificatifs soient traités pour l'étude de ma demande, conformément à la <Link href="/confidentialite" target="_blank" className="font-semibold text-teal-700 underline">politique de confidentialité</Link>.{err("acceptData") && <span className="block text-[#C93B3B]">{err("acceptData")}</span>}</span>
                  </label>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-10 flex flex-col-reverse gap-3 border-t border-night/[.07] pt-6 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || pending} className={step === 0 ? "invisible" : ""}>Retour</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next} size="lg">Continuer</Button>
          ) : (
            <Button onClick={submit} size="lg" variant="teal" loading={pending}>Envoyer ma demande</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Recap({ title, rows, onEdit }: { title: string; rows: [string, string | undefined][]; onEdit: () => void }) {
  return (
    <div className="rounded-2xl bg-paper p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display font-bold">{title}</p>
        <button type="button" onClick={onEdit} className="text-sm font-medium text-teal-700 hover:underline">Modifier</button>
      </div>
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}><dt className="text-ink-faint">{k}</dt><dd className="font-medium break-words">{v || "—"}</dd></div>
        ))}
      </dl>
    </div>
  );
}
