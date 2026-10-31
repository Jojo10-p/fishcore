"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState, useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FormStatus, type ActionState } from "@/components/ui/form-status";
import { uploadCustomerDocument } from "@/server/actions/customer";
import { DOCUMENT_TYPES } from "@/lib/status";

export function UploadForm({ applications, applicationId, requestId, defaultType = "other", compact }: { applications?: { id: string; reference: string }[]; applicationId?: string; requestId?: string; defaultType?: string; compact?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadCustomerDocument, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    if (state?.ok) { toast.success(state.message); ref.current?.reset(); setName(""); }
  }, [state]);
  return (
    <form ref={ref} onSubmit={submitWith(action)} className="space-y-4">
      {!state?.ok && <FormStatus state={state} />}
      {requestId && <input type="hidden" name="requestId" value={requestId} />}
      {applicationId && !applications && <input type="hidden" name="applicationId" value={applicationId} />}
      <div className={compact ? "flex flex-col gap-3 sm:flex-row sm:items-end" : "grid gap-4 sm:grid-cols-2"}>
        {applications && (
          <Field label="Dossier concerné" htmlFor="applicationId">
            <Select id="applicationId" name="applicationId" defaultValue={applicationId ?? ""}>
              <option value="">Aucun (document de profil)</option>
              {applications.map((a) => <option key={a.id} value={a.id}>{a.reference}</option>)}
            </Select>
          </Field>
        )}
        {!requestId ? (
          <Field label="Type de document" htmlFor="type">
            <Select id="type" name="type" defaultValue={defaultType}>
              {Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="type" value={defaultType} />
        )}
        <label className={`flex h-11 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-night/25 px-4 text-sm text-ink-soft hover:border-teal focus-within:ring-4 focus-within:ring-teal/15 ${applications ? "sm:col-span-2" : ""}`}>
          <FileUp className="h-4 w-4 shrink-0" />
          <span className="truncate">{name || "Choisir un fichier (PDF, JPG, PNG, WEBP — 8 Mo)"}</span>
          <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setName(e.target.files?.[0]?.name ?? "")} required />
        </label>
        <Button type="submit" loading={pending} disabled={!name}>Transmettre</Button>
      </div>
    </form>
  );
}
