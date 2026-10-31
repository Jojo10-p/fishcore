"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormStatus, type ActionState } from "@/components/ui/form-status";
import { submitContact } from "@/server/actions/contact";

export function ContactForm({ labels }: { labels: Record<"name" | "email" | "phone" | "subject" | "message" | "submit" | "success", string> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitContact, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  const e = state?.errors ?? {};
  return (
    <form ref={ref} onSubmit={submitWith(action)} className="space-y-5" noValidate>
      {state?.ok ? <FormStatus state={{ ok: true, message: labels.success }} /> : <FormStatus state={state} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={labels.name} htmlFor="name" error={e.name} required><Input id="name" name="name" autoComplete="name" required aria-invalid={!!e.name} /></Field>
        <Field label={labels.email} htmlFor="email" error={e.email} required><Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!e.email} /></Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={labels.phone} htmlFor="phone" error={e.phone}><Input id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
        <Field label={labels.subject} htmlFor="subject" error={e.subject} required><Input id="subject" name="subject" required aria-invalid={!!e.subject} /></Field>
      </div>
      <Field label={labels.message} htmlFor="message" error={e.message} required><Textarea id="message" name="message" rows={6} required aria-invalid={!!e.message} /></Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <Button type="submit" size="lg" loading={pending}>{labels.submit}</Button>
    </form>
  );
}
