"use client";

import { useEffect, useRef, useState } from "react";

// Dictée : la voix est transformée en texte par le navigateur (rien n'est
// stocké sur le serveur). Chrome / Android : français pris en charge.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function makeRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

/** « 🎙️ Dicter » : on parle, le texte s'écrit tout seul dans le champ. */
export function DictateButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSupported(!!makeRecognition()), 0);
    return () => {
      clearTimeout(t);
      rec.current?.stop();
    };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = makeRecognition();
    if (!r) return;
    r.lang = "fr-FR";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text.trim()) onText(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      setError(e.error === "not-allowed" ? "Micro refusé : autorisez le micro pour ce site." : e.error === "network" ? "La dictée a besoin d'Internet." : null);
    };
    setError(null);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold disabled:opacity-50 ${
          listening ? "animate-pulse border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
        }`}
      >
        {listening ? "⏹️ J'ai fini de parler" : "🎙️ Dicter (la voix s'écrit en texte)"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
