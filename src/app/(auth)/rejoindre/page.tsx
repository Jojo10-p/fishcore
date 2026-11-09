"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BoutiquePicker } from "@/components/auth/boutique-picker";

// « Me rattacher avec un code » : on tape le code donné par le patron, puis on crée
// son compte. Le poste (caissier, gérant…) vient du code.
export default function JoinWithCodePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [boutique, setBoutique] = useState<string | null>(null);
  const [shops, setShops] = useState(0);
  const mustChoose = shops > 1 && !boutique;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  // Un lien complet collé fonctionne aussi
  const raw = code.trim();
  const isLink = raw.includes("/rejoindre/");
  const clean = isLink ? (raw.split("/").filter(Boolean).pop() ?? "") : raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const shown = isLink ? raw : clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
  const ready = isLink ? clean.length >= 20 : clean.length === 8;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/invitations/accept?token=${encodeURIComponent(clean)}${boutique ? `&boutique=${boutique}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.success) return setError(j.error ?? "Code refusé");
      router.push(`/rejoindre/${encodeURIComponent(clean)}`);
    } catch {
      setError("Connexion impossible. Vérifiez Internet.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-blue-50 to-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo GJH statique */}
          <img src="/icons/gjh-logo.png" alt="GRACES JUMELLES HOUSE" className="mx-auto mb-4 h-24 w-auto object-contain" />
          <h1 className="text-2xl font-bold text-gray-900">Me rattacher avec un code</h1>
          <p className="text-sm text-gray-500 mt-1">Tapez le code que le patron vous a donné</p>
        </div>
        <BoutiquePicker
          onLoaded={setShops}
          value={boutique}
          onChange={(id) => {
            setBoutique(id);
            setError(null);
            setTimeout(() => input.current?.focus(), 50);
          }}
        />
        {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{error}</p>}
        <form onSubmit={submit} className="space-y-4">
          <input
            ref={input}
            value={shown}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            className={`w-full rounded-xl border-2 border-gray-300 px-4 py-4 text-center font-bold focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 ${isLink ? "text-sm" : "font-mono text-3xl tracking-[0.25em] uppercase"}`}
          />
          <button type="submit" disabled={!ready || busy || mustChoose} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-300">
            {busy ? "Vérification…" : "Continuer"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-gray-500">Le code fixe votre poste (caissier, gérant…). Il sert une seule fois.</p>
        <p className="mt-6 text-center text-sm text-gray-500">
          Déjà un compte ? <Link href="/login" className="font-medium text-blue-600 hover:underline">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
