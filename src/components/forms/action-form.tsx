"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormStatus, type ActionState } from "@/components/ui/form-status";

/**
 * Formulaire générique branché sur une Server Action.
 * Succès → toast ; échec → message + erreurs de champs listées.
 */
export function ActionForm({ action, submitLabel, children, className, resetOnSuccess, variant, fieldLabels }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  submitLabel: string;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  variant?: "primary" | "teal" | "outline" | "danger";
  fieldLabels?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) ref.current?.reset();
    }
  }, [state, resetOnSuccess]);
  const fieldErrors = Object.entries(state?.errors ?? {}).filter(([, v]) => v?.length);
  return (
    <form ref={ref} onSubmit={submitWith(formAction)} className={className ?? "space-y-5"} noValidate>
      {state && !state.ok && (
        <div className="space-y-2">
          <FormStatus state={state} />
          {fieldErrors.length > 0 && (
            <ul className="list-inside list-disc text-[13px] text-[#B03030]">
              {fieldErrors.map(([k, v]) => <li key={k}><span className="font-medium">{fieldLabels?.[k] ?? k}</span> : {v![0]}</li>)}
            </ul>
          )}
        </div>
      )}
      {children}
      <div><Button type="submit" loading={pending} variant={variant}>{submitLabel}</Button></div>
    </form>
  );
}
