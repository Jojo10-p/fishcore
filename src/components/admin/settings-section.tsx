"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/field";
import { FormStatus, type ActionState } from "@/components/ui/form-status";
import { saveSettings } from "@/server/actions/admin/manage";

export interface SettingField { path: string; label: string; type?: "text" | "textarea" | "number" | "checkbox" | "select" | "multi" | "team"; options?: { value: string; label: string }[]; hint?: string; full?: boolean; rows?: number }

type Obj = Record<string, unknown>;
const get = (o: Obj, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a as Obj | undefined)?.[k], o);
function setIn(o: Obj, path: string, v: unknown): Obj {
  const [h, ...rest] = path.split(".");
  return { ...o, [h]: rest.length ? setIn((o[h] as Obj) ?? {}, rest.join("."), v) : v };
}

export function SettingsSection({ section, initial, fields, disabled, submitLabel = "Enregistrer" }: { section: string; initial: Obj; fields: SettingField[]; disabled?: boolean; submitLabel?: string }) {
  const [value, setValue] = useState<Obj>(initial);
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSettings, undefined);
  useEffect(() => { if (state?.ok) toast.success(state.message); }, [state]);
  const set = (path: string, v: unknown) => setValue((s) => setIn(s, path, v));
  const errs = state?.errors ?? {};

  return (
    <form onSubmit={submitWith(action)} className="space-y-5">
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="payload" value={JSON.stringify(value)} />
      {state && !state.ok && <FormStatus state={state} />}
      <fieldset disabled={disabled} className="grid gap-5 sm:grid-cols-2">
        {fields.map((f) => {
          const id = `${section}-${f.path}`;
          const v = get(value, f.path);
          const err = errs[f.path.split(".")[0]] ?? errs[f.path.split(".").pop()!];
          if (f.type === "checkbox")
            return <label key={f.path} className="flex items-start gap-3 sm:col-span-2"><Checkbox checked={!!v} onChange={(e) => set(f.path, e.target.checked)} className="mt-0.5" /><span><span className="block font-medium">{f.label}</span>{f.hint && <span className="text-sm text-ink-soft">{f.hint}</span>}</span></label>;
          if (f.type === "multi")
            return (
              <fieldset key={f.path} className="sm:col-span-2"><legend className="mb-2 text-sm font-medium">{f.label}</legend><div className="flex flex-wrap gap-4">
                {f.options!.map((o) => { const arr = (v as string[]) ?? []; return <label key={o.value} className="flex items-center gap-2 text-sm"><Checkbox checked={arr.includes(o.value)} onChange={(e) => set(f.path, e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />{o.label}</label>; })}
              </div></fieldset>
            );
          if (f.type === "team") {
            const team = (v as { name: string; role: string }[]) ?? [];
            return (
              <div key={f.path} className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium">{f.label}</p>
                <ul className="space-y-2">
                  {team.map((m, i) => (
                    <li key={i} className="flex gap-2">
                      <Input aria-label="Nom" placeholder="Nom" value={m.name} onChange={(e) => set(f.path, team.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <Input aria-label="Fonction" placeholder="Fonction" value={m.role} onChange={(e) => set(f.path, team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                      <button type="button" className="rounded-lg p-2 text-ink-faint hover:text-[#B03030]" aria-label="Retirer" onClick={() => set(f.path, team.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => set(f.path, [...team, { name: "", role: "" }])}><Plus className="h-4 w-4" />Ajouter un membre</Button>
              </div>
            );
          }
          return (
            <Field key={f.path} label={f.label} htmlFor={id} hint={f.hint} error={err} className={f.full || f.type === "textarea" ? "sm:col-span-2" : ""}>
              {f.type === "textarea" ? <Textarea id={id} rows={f.rows ?? 4} value={(v as string) ?? ""} onChange={(e) => set(f.path, e.target.value)} />
                : f.type === "select" ? <Select id={id} value={(v as string) ?? ""} onChange={(e) => set(f.path, e.target.value)}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                : <Input id={id} type={f.type === "number" ? "number" : "text"} value={(v as string | number) ?? ""} onChange={(e) => set(f.path, f.type === "number" ? Number(e.target.value) : e.target.value)} />}
            </Field>
          );
        })}
      </fieldset>
      {!disabled && <Button type="submit" loading={pending}>{submitLabel}</Button>}
    </form>
  );
}
