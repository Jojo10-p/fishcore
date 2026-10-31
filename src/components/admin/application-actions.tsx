"use client";
import { submitWith } from "@/components/forms/use-submit";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, X, Lock, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea, Input, Checkbox } from "@/components/ui/field";
import { FormStatus, type ActionState } from "@/components/ui/form-status";
import { ConfirmButton } from "@/components/ui/confirm";
import { changeStatus, requestDocument, reviewDocument, assignApplication, cancelDocumentRequest } from "@/server/actions/admin/applications";
import { APPLICATION_STATUSES, APPLICATION_STATUS_META, DECISION_STATUSES, DOCUMENT_TYPES } from "@/lib/status";
import type { ApplicationStatus } from "@/generated/prisma/enums";

function useToastResult(state: ActionState, reset?: () => void) {
  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast.success(state.message);
      reset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

export function StatusForm({ id, current, canDecide, licensed }: { id: string; current: ApplicationStatus; canDecide: boolean; licensed: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(changeStatus, undefined);
  const [status, setStatus] = useState<ApplicationStatus | "">("");
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useToastResult(state, () => { ref.current?.reset(); setStatus(""); setConfirm(false); });
  const isDecision = !!status && DECISION_STATUSES.includes(status);
  const decisionLocked = !licensed || !canDecide;

  return (
    <form ref={ref} className="space-y-4" onSubmit={submitWith(action, () => { if (isDecision && !confirm) { setConfirm(true); return false; } return true; })}>
      <input type="hidden" name="id" value={id} />
      {state && !state.ok && <FormStatus state={state} />}
      <Field label="Nouveau statut" htmlFor="status">
        <Select id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)} required>
          <option value="">Choisir…</option>
          {APPLICATION_STATUSES.filter((s) => s !== current).map((s) => {
            const locked = DECISION_STATUSES.includes(s) && decisionLocked;
            return <option key={s} value={s} disabled={locked}>{APPLICATION_STATUS_META[s].label}{locked ? " — verrouillé" : ""}</option>;
          })}
        </Select>
      </Field>
      {decisionLocked && (
        <p className="flex gap-2 rounded-xl bg-champagne-50 p-3 text-xs leading-relaxed text-champagne-700">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {!licensed ? "Approbation et refus sont désactivés tant que l'agrément de l'établissement n'est pas renseigné (Paramètres › Conformité)." : "Votre rôle ne permet pas de prendre de décision."}
        </p>
      )}
      {isDecision && (
        <Field label="Justification de la décision" htmlFor="decisionReason" hint="Conservée au dossier et visible par le client." required>
          <Textarea id="decisionReason" name="decisionReason" rows={3} required minLength={10} />
        </Field>
      )}
      <Field label="Commentaire communiqué au client" htmlFor="publicComment" hint="Facultatif — visible dans l'espace client et envoyé par email.">
        <Textarea id="publicComment" name="publicComment" rows={3} />
      </Field>
      <Button type="submit" loading={pending} disabled={!status} className="w-full">{isDecision ? "Enregistrer la décision" : "Mettre à jour le statut"}</Button>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={`Confirmer : ${status ? APPLICATION_STATUS_META[status].label : ""}`} description="Cette décision sera notifiée au client et historisée. Elle ne peut pas être annulée silencieusement.">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onClick={() => setConfirm(false)}>Annuler</Button>
          <Button size="sm" type="button" loading={pending} variant={status === "REJECTED" ? "danger" : "primary"} onClick={() => ref.current?.requestSubmit()}>Confirmer</Button>
        </div>
      </Dialog>
    </form>
  );
}

export function RequestDocForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestDocument, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useToastResult(state, () => ref.current?.reset());
  return (
    <form ref={ref} onSubmit={submitWith(action)} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      {state && !state.ok && <FormStatus state={state} />}
      <Field label="Type de pièce" htmlFor="rq-type">
        <Select id="rq-type" name="type" defaultValue="other">{Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </Field>
      <Field label="Intitulé précis" htmlFor="rq-label" hint="Ex. : bulletins de salaire des 3 derniers mois"><Input id="rq-label" name="label" /></Field>
      <Field label="Message au client" htmlFor="rq-msg"><Textarea id="rq-msg" name="message" rows={2} /></Field>
      <label className="flex items-center gap-2 text-sm"><Checkbox name="setStatus" defaultChecked />Passer le dossier en « Documents manquants »</label>
      <Button type="submit" variant="outline" loading={pending} className="w-full">Demander la pièce</Button>
    </form>
  );
}

export function DocReview({ docId, status, canReview }: { docId: string; status: "PENDING" | "ACCEPTED" | "REJECTED"; canReview: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  if (!canReview || status !== "PENDING") return null;
  const run = (s: "ACCEPTED" | "REJECTED") =>
    start(async () => {
      const r = await reviewDocument(docId, s, note);
      r.ok ? toast.success(r.message) : toast.error(r.message);
      if (r.ok) setOpen(false);
    });
  return (
    <>
      <button type="button" disabled={pending} onClick={() => run("ACCEPTED")} className="rounded-lg p-2 text-[#167A3B] hover:bg-[#E7F6EC]" aria-label="Valider le document" title="Valider"><Check className="h-4 w-4" /></button>
      <button type="button" disabled={pending} onClick={() => setOpen(true)} className="rounded-lg p-2 text-[#B03030] hover:bg-[#FCEBEB]" aria-label="Refuser le document" title="Refuser"><X className="h-4 w-4" /></button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Refuser le document" description="Le client sera notifié et invité à transmettre un nouveau document.">
        <Field label="Motif du refus" htmlFor={`note-${docId}`}><Textarea id={`note-${docId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
          <Button variant="danger" size="sm" loading={pending} onClick={() => run("REJECTED")}>Refuser</Button>
        </div>
      </Dialog>
    </>
  );
}

export function AssignSelect({ id, value, agents }: { id: string; value: string | null; agents: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <Select
      aria-label="Agent en charge"
      value={value ?? ""}
      disabled={pending}
      onChange={(e) => start(async () => { const r = await assignApplication(id, e.target.value || null); r.ok ? toast.success(r.message) : toast.error(r.message); })}
    >
      <option value="">Non attribué</option>
      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </Select>
  );
}

export function CancelRequestButton({ id }: { id: string }) {
  return (
    <ConfirmButton variant="ghost" size="sm" title="Annuler cette demande de pièce ?" confirmLabel="Annuler la demande" onConfirm={async () => { const r = await cancelDocumentRequest(id); toast.success(r.message); }}>
      Annuler
    </ConfirmButton>
  );
}

export function PrintButton() {
  return <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimer</Button>;
}
