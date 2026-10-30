"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

interface Info {
  firstName: string;
  companyName: string | null;
}

// Lien reçu par WhatsApp/SMS : l'employé choisit son nouveau mot de passe
export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/password-reset?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.success ? setInfo(j.data) : setInvalid(j.error ?? "Lien invalide")))
      .catch(() => setInvalid("Connexion impossible. Réessayez avec Internet."));
  }, [token]);

  const rules = [
    { ok: password.length >= 8, label: "8 caractères minimum" },
    { ok: /[A-Z]/.test(password), label: "une majuscule" },
    { ok: /[0-9]/.test(password), label: "un chiffre" },
    { ok: password.length > 0 && password === confirm, label: "les deux saisies identiques" },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? "Erreur");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8 space-y-5">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">Nouveau mot de passe</h1>
          {info?.companyName && <p className="text-sm text-gray-500 mt-1">{info.companyName}</p>}
        </div>
        {invalid ? (
          <div className="space-y-4 text-center">
            <p className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{invalid}</p>
            <Link href="/mot-de-passe-oublie" className="text-sm text-blue-600 hover:underline">
              Que faire ?
            </Link>
          </div>
        ) : done ? (
          <div className="space-y-4 text-center">
            <p className="rounded-xl border border-green-200 bg-green-50 p-3.5 text-sm text-green-800">
              Mot de passe changé. Vous pouvez vous connecter ; vos autres appareils ont été déconnectés par sécurité.
            </p>
            <Link href="/login" className="inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              Se connecter
            </Link>
          </div>
        ) : !info ? (
          <p className="text-center text-sm text-gray-500">Vérification du lien…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-gray-700">Bonjour {info.firstName}, choisissez votre nouveau mot de passe.</p>
            {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Nouveau mot de passe"
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirmer le mot de passe"
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <ul className="space-y-1 text-xs">
              {rules.map((r) => (
                <li key={r.label} className={r.ok ? "text-green-700" : "text-gray-500"}>
                  {r.ok ? "✓" : "○"} {r.label}
                </li>
              ))}
            </ul>
            <button
              type="submit"
              disabled={busy || !rules.every((r) => r.ok)}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
            >
              {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
