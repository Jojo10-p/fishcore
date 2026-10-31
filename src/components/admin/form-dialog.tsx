"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormStatus, type ActionState } from "@/components/ui/form-status";

/** Bouton ouvrant un formulaire en boîte de dialogue, branché sur une Server Action. */
export function FormDialog({ trigger, triggerProps, title, description, action, submitLabel = "Enregistrer", children, wide }: {
  trigger: React.ReactNode;
  triggerProps?: ButtonProps;
  title: string;
  description?: string;
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  submitLabel?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  useEffect(() => {
    if (state?.ok) { toast.success(state.message); setOpen(false); }
  }, [state]);
  const errs = Object.entries(state?.errors ?? {}).filter(([, v]) => v?.length);
  return (
    <>
      <Button type="button" {...triggerProps} onClick={() => setOpen(true)}>{trigger}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description} className={wide ? "w-[min(94vw,720px)]" : undefined}>
        {open && (
          <form onSubmit={submitWith(formAction)} className="max-h-[70vh] space-y-4 overflow-y-auto px-0.5 pb-1">
            {state && !state.ok && (
              <div className="space-y-1">
                <FormStatus state={state} />
                {errs.map(([k, v]) => <p key={k} className="text-[13px] text-[#B03030]">{k} : {v![0]}</p>)}
              </div>
            )}
            {children}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" size="sm" loading={pending}>{submitLabel}</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
