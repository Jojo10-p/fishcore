"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { AUTH_ERRORS, GoogleButton } from "@/components/auth/google-button";
import { clearSessionCache } from "@/components/app/session-provider";

interface Info {
  companyName: string;
  roleName: string;
  role: string;
  centerName: string | null;
  label: string | null;
  expiresAt: string;
}

const input = "w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

function JoinForm({ token }: { token: string }) {
  const router = useRouter();
  const qs = useSearchParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(AUTH_ERRORS[qs.get("erreur") ?? ""] ?? null);

  useEffect(() => {
    fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) return setInvalid(j.error ?? "Lien invalide");
        setInfo(j.data);
        if (j.data.label) setF((x) => ({ ...x, firstName: x.firstName || j.data.label }));
      })
      .catch(() => setInvalid("Connexion impossible. Réessayez avec Internet."));
  }, [token]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const mismatch = f.confirm.length > 0 && f.password !== f.confirm;
  const ready = f.firstName.trim() && f.lastName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 8 && f.password === f.confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone || undefined, password: f.password }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        setError(j.error ?? "Création du compte impossible");
        return;
      }
      clearSessionCache();
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Impossible de créer le compte. Vérifiez votre connexion Internet.");
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
          <h1 className="text-2xl font-bold text-gray-900">Créer mon compte</h1>
        </div>

        {invalid ? (
          <div className="space-y-4 text-center">
            <p className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{invalid}</p>
            <Link href="/login" className="inline-block text-sm font-medium text-blue-600 hover:underline">Aller à la connexion</Link>
          </div>
        ) : !info ? (
          <p className="text-center text-sm text-gray-500">Vérification du lien…</p>
        ) : (
          <>
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-gray-800">
              Vous êtes invité à rejoindre <strong>{info.companyName}</strong> comme <strong>{info.roleName}</strong>
              {info.centerName ? <> — {info.centerName}</> : null}.
            </div>
            {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{error}</p>}

            <GoogleButton invite={token} label="Créer mon compte avec Google" />

            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-700">Prénom</span>
                  <input className={input} value={f.firstName} onChange={set("firstName")} autoComplete="given-name" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-700">Nom</span>
                  <input className={input} value={f.lastName} onChange={set("lastName")} autoComplete="family-name" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Adresse e-mail</span>
                <input className={input} type="email" value={f.email} onChange={set("email")} autoComplete="email" placeholder="vous@exemple.com" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Téléphone (facultatif)</span>
                <input className={input} type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" placeholder="+229 …" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Mot de passe</span>
                <input className={input} type="password" value={f.password} onChange={set("password")} autoComplete="new-password" placeholder="8 caractères minimum" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Confirmer le mot de passe</span>
                <input className={input} type="password" value={f.confirm} onChange={set("confirm")} autoComplete="new-password" />
                {mismatch && <span className="mt-1 block text-xs text-red-600">Les deux mots de passe ne sont pas identiques</span>}
              </label>
              <button type="submit" disabled={!ready || busy} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-300">
                {busy ? "Création du compte…" : "Créer mon compte"}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-gray-500">
              Déjà un compte ? <Link href="/login" className="font-medium text-blue-600 hover:underline">Se connecter</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// Lien d'invitation reçu par WhatsApp/SMS
export default function JoinWithTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <Suspense fallback={null}>
      <JoinForm token={token} />
    </Suspense>
  );
}
