"use client";

import { useEffect, useRef, useState } from "react";

export interface VoiceNote {
  data: string; // base64
  mime: string;
  seconds: number;
  url: string; // pour la réécoute avant envoi
}

const MAX_SECONDS = 90;

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Bouton « 🎤 Note vocale » : appuyer pour parler, appuyer pour arrêter ; réécoute et suppression avant envoi. */
export function VoiceRecorder({ value, onChange, disabled }: { value: VoiceNote | null; onChange: (v: VoiceNote | null) => void; disabled?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stop();
    setRecording(false);
  };

  const start = async () => {
    setError(null);
    const mime = pickMime();
    if (!navigator.mediaDevices?.getUserMedia || !mime) {
      setError("Ce téléphone ne permet pas d'enregistrer une note vocale ici. Écrivez le motif.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const secs = Math.max(1, Math.min(MAX_SECONDS, Math.round((Date.now() - started.current) / 1000)));
        const blob = new Blob(chunks, { type: mime.split(";")[0] });
        if (blob.size < 200) return setError("Rien n'a été enregistré. Réessayez en parlant près du micro.");
        onChange({ data: await toBase64(blob), mime: mime.split(";")[0], seconds: secs, url: URL.createObjectURL(blob) });
      };
      rec.current = r;
      started.current = Date.now();
      setSeconds(0);
      r.start();
      setRecording(true);
      timer.current = setInterval(() => {
        const s = Math.round((Date.now() - started.current) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
    } catch {
      setError("Micro refusé. Autorisez le micro pour ce site, ou écrivez le motif.");
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-2">
        <audio src={value.url} controls className="h-9 min-w-0 flex-1" />
        <span className="text-xs text-green-800">{value.seconds} s</span>
        <button type="button" className="rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50" onClick={() => onChange(null)} aria-label="Supprimer la note vocale">
          🗑️
        </button>
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (recording ? stop() : void start())}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
          recording ? "animate-pulse border-red-500 bg-red-50 text-red-700" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
        }`}
      >
        {recording ? (
          <>⏹️ Arrêter ({seconds} s / {MAX_SECONDS} s)</>
        ) : (
          <>🎤 Enregistrer une note vocale</>
        )}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
