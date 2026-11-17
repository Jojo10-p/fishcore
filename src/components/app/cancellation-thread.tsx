"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Spinner, Textarea } from "@/components/ui";
import { useSession } from "@/components/app/session-provider";
import { VoiceRecorder, type VoiceNote } from "@/components/app/voice-recorder";
import { DictateButton } from "@/components/app/dictate-button";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface Message {
  id: string;
  createdAt: string;
  authorId: string;
  text: string | null;
  hasAudio: boolean;
  audioExpired?: boolean;
  audioSeconds: number | null;
  author: { firstName: string; lastName: string; role: string } | null;
}

const ROLE: Record<string, string> = { COMPANY_OWNER: "Direction", CENTER_MANAGER: "Gérant", CASHIER: "Caissier" };

/** Discussion sur une demande d'annulation : messages écrits et notes vocales. */
export function CancellationThread({ cancellationId, reason, canWrite = true }: { cancellationId: string; reason: string; canWrite?: boolean }) {
  const { session } = useSession();
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<VoiceNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiGet<{ data: Message[] }>(`/api/cancellations/${cancellationId}/messages`)
        .then((r) => setMsgs(r.data))
        .catch((e) => setError(errorMessage(e))),
    [cancellationId]
  );
  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/cancellations/${cancellationId}/messages`, {
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(voice ? { voice: { data: voice.data, mime: voice.mime, seconds: voice.seconds } } : {}),
      });
      setText("");
      setVoice(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Le motif écrit de la demande, puis l'échange
  const first = msgs?.[0];
  const reasonIsVoice = reason.startsWith("🎤");
  return (
    <div className="space-y-3">
      {!reasonIsVoice && (
        <div className="rounded-xl bg-gray-50 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Motif de la demande</p>
          <p className="mt-0.5 whitespace-pre-line">{reason}</p>
        </div>
      )}
      {!msgs ? (
        <Spinner />
      ) : (
        <ul className="space-y-2">
          {msgs.map((m) => {
            const mine = m.authorId === session?.user.id;
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"}`}>
                  <p className={`text-[11px] font-semibold ${mine ? "text-blue-100" : "text-gray-500"}`}>
                    {m.author ? `${m.author.firstName} · ${ROLE[m.author.role] ?? ""}` : ""} · {new Date(m.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                    {m === first && reasonIsVoice ? " · motif" : ""}
                  </p>
                  {m.audioExpired && <p className={`mt-1 text-xs italic ${mine ? "text-blue-100" : "text-gray-500"}`}>🔇 Note vocale de {m.audioSeconds} s effacée (gardée 30 jours)</p>}
                  {m.hasAudio && <audio controls preload="none" src={`/api/cancellations/${cancellationId}/messages/${m.id}`} className="mt-1 h-9 w-64 max-w-full" />}
                  {m.text && <p className="mt-1 whitespace-pre-line">{m.text}</p>}
                </div>
              </li>
            );
          })}
          {msgs.length === 0 && <p className="text-center text-xs text-gray-400">Aucun message pour l&apos;instant.</p>}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}
      {canWrite && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Écrire un message (ex. « Explique-moi pourquoi »)…" />
          <div className="grid gap-2 sm:grid-cols-2">
            <DictateButton disabled={busy} onText={(t) => setText((x) => (x.trim() ? `${x.trim()} ${t}` : t))} />
            <VoiceRecorder value={voice} onChange={setVoice} disabled={busy} />
          </div>
          <div className="flex justify-end">
            <Button onClick={send} loading={busy} disabled={!text.trim() && !voice}>
              Envoyer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
