"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Checkbox } from "@/components/ui/field";
import { FormStatus, type ActionState } from "@/components/ui/form-status";

export interface AuthField { name: string; label: string; type?: string; autoComplete?: string; hint?: string; half?: boolean }

export function AuthForm({ action, fields, submitLabel, hidden, consent, invert }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  fields: AuthField[];
  submitLabel: string;
  hidden?: Record<string, string>;
  consent?: React.ReactNode;
  invert?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const e = state?.errors ?? {};
  return (
    <form onSubmit={submitWith(formAction)} className="space-y-5" noValidate>
      <FormStatus state={state} />
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.name} label={f.label} htmlFor={f.name} error={e[f.name]} hint={f.hint} className={f.half ? "" : "sm:col-span-2"}>
            <Input id={f.name} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} aria-invalid={!!e[f.name]} required />
          </Field>
        ))}
      </div>
      {consent && (
        <label className="flex gap-3 text-sm leading-relaxed text-ink-soft">
          <Checkbox name="acceptData" />
          <span>{consent}{e.acceptData && <span className="block text-[#C93B3B]">{e.acceptData[0]}</span>}</span>
        </label>
      )}
      <Button type="submit" size="lg" className="w-full" loading={pending} variant={invert ? "teal" : "primary"}>{submitLabel}</Button>
    </form>
  );
}
