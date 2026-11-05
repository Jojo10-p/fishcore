"use client";

import { useEffect, useRef, useState } from "react";
import { clearSessionCache } from "@/components/app/session-provider";

// Compte créé, pas encore rattaché : on tape le code donné par le patron
// (comme le code de connexion de WhatsApp Web).
export default function WelcomePage() {
  const [name, setName] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ companyName: string; roleName: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.status === 401 ? (window.location.replace("/login"), null) : r.json()))
      .then((j) => {
        if (!j?.success) return;
        if (j.data.company) return window.location.replace("/dashboard");
        setName(j.data.user.firstName);
      })
      .catch(() => undefined);
    input.current?.focus();
  }, []);

  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const shown = clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clean.length !== 8) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invitations/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: clean }) });
      const j = await res.json();
      if (!res.ok || !j.success) return setError(j.error ?? "Code refusé");
      clearSessionCache();
      setJoined(j.data);
      setTimeout(() => window.location.replace("/dashboard"), 1500);
    } catch {
      setError("Connexion impossible. Vérifiez Internet.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    clearSessionCache();
    window.location.replace("/login");
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-blue-50 to-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo GJH statique */}
          <img src="/icons/gjh-logo.png" alt="GRACES JUMELLES HOUSE" className="mx-auto mb-4 h-24 w-auto object-contain" />
          <h1 className="text-2xl font-bold text-gray-900">{name ? `Bienvenue ${name}` : "Bienvenue"}</h1>
          <p className="mt-1 text-sm text-gray-500">Votre compte est créé. Il reste à rejoindre l&apos;entreprise.</p>
        </div>

        {joined ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center text-sm text-green-800">
            ✓ Vous avez rejoint <strong>{joined.companyName}</strong> comme <strong>{joined.roleName}</strong>. Ouverture…
          </div>
        ) : (
          <>
            <ol className="mb-6 space-y-2.5 text-sm text-gray-700">
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">1</span>Demandez le code au patron (ou au responsable).</li>
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">2</span>Il le crée dans son compte : Utilisateurs › Inviter.</li>
              <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">3</span>Tapez le code ici : votre poste (caissier, gérant…) est réglé tout seul.</li>
            </ol>
            {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{error}</p>}
            <form onSubmit={submit} className="space-y-4">
              <label className="block text-center">
                <span className="mb-2 block text-sm font-medium text-gray-700">Code à 8 caractères</span>
                <input
                  ref={input}
                  value={shown}
                  onChange={(e) => setCode(e.target.value)}
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  placeholder="XXXX-XXXX"
                  className="w-full rounded-xl border-2 border-gray-300 px-4 py-4 text-center font-mono text-3xl font-bold tracking-[0.25em] uppercase focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                />
              </label>
              <button type="submit" disabled={clean.length !== 8 || busy} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-300">
                {busy ? "Vérification…" : "Rejoindre l'entreprise"}
              </button>
            </form>
            <button onClick={logout} className="mt-6 w-full text-center text-sm text-gray-500 hover:underline">
              Se déconnecter
            </button>
          </>
        )}
      </div>
    </div>
  );
}
