"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { FormStatus, type ActionState } from "@/components/ui/form-status";

export function ReplyForm({ action, hidden, placeholder = "Votre message…", label = "Envoyer", extra }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; hidden: Record<string, string>; placeholder?: string; label?: string; extra?: React.ReactNode }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} onSubmit={submitWith(formAction)} className="space-y-3">
      {state && !state.ok && <FormStatus state={state} />}
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label htmlFor="reply" className="sr-only">Message</label>
      <Textarea id="reply" name="message" rows={4} placeholder={placeholder} required />
      <div className="flex flex-wrap items-center justify-between gap-3">{extra}<Button type="submit" loading={pending} className="ml-auto">{label}</Button></div>
    </form>
  );
}
