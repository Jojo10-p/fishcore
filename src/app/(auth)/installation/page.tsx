"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ─────────────────────────────────────────────
// Installation : le super administrateur choisit son mot de passe
// et renseigne l'entreprise (ou redéfinit son mot de passe s'il l'a oublié)
// ─────────────────────────────────────────────

interface Setup {
  email: string;
  code: string;
  mode: "install" | "reset";
}

const field = "w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

export default function InstallationPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [f, setF] = useState({ password: "", confirm: "", tradeName: "", ownerName: "", phone: "", address: "", city: "", taxId: "", tradeRegNumber: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem("fishcore-setup");
        if (raw) return setSetup(JSON.parse(raw));
      } catch {
        // stockage indisponible
      }
      router.replace("/login");
    }, 0);
    return () => clearTimeout(t);
  }, [router]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pwOk = f.password.length >= 8 && /[A-Z]/.test(f.password) && /[0-9]/.test(f.password);
  const mismatch = f.confirm.length > 0 && f.password !== f.confirm;
  const install = setup?.mode === "install";
  const ready = pwOk && f.password === f.confirm && (!install || (f.tradeName.trim().length >= 2 && f.ownerName.trim().length >= 2 && f.phone.trim().length >= 8));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setup || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: setup.email,
          code: setup.code,
          password: f.password,
          ...(install
            ? { company: { tradeName: f.tradeName, ownerName: f.ownerName, phone: f.phone, address: f.address || undefined, city: f.city || undefined, taxId: f.taxId || undefined, tradeRegNumber: f.tradeRegNumber || undefined } }
            : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) return setError(j.error ?? "Impossible de terminer l'installation");
      try {
        sessionStorage.removeItem("fishcore-setup");
      } catch {
        // rien
      }
      router.replace(j.data?.next ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Impossible de terminer. Vérifiez votre connexion Internet.");
    } finally {
      setBusy(false);
    }
  };

  if (!setup) return <div className="min-h-dvh bg-gradient-to-br from-blue-50 to-gray-50" />;

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-blue-50 to-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo GJH statique */}
          <img src="/icons/gjh-logo.png" alt="GRACES JUMELLES HOUSE" className="mx-auto mb-4 h-24 w-auto object-contain" />
          <h1 className="text-2xl font-bold text-gray-900">{install ? "Installation" : "Nouveau mot de passe"}</h1>
          <p className="mt-1 text-sm text-gray-500">{install ? "Vous êtes le super administrateur" : "Super administrateur"}</p>
          <p className="mt-1 text-sm font-medium text-gray-700">{setup.email}</p>
        </div>
        {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{error}</p>}
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm font-semibold text-gray-900">Votre mot de passe</p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Mot de passe</span>
            <input className={field} type="password" value={f.password} onChange={set("password")} autoComplete="new-password" autoFocus />
            <span className={`mt-1 block text-xs ${f.password && !pwOk ? "text-red-600" : "text-gray-500"}`}>8 caractères minimum, dont une majuscule et un chiffre. Gardez-le pour vous.</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Confirmer le mot de passe</span>
            <input className={field} type="password" value={f.confirm} onChange={set("confirm")} autoComplete="new-password" />
            {mismatch && <span className="mt-1 block text-xs text-red-600">Les deux mots de passe ne correspondent pas.</span>}
          </label>

          {install && (
            <>
              <p className="pt-2 text-sm font-semibold text-gray-900">Votre entreprise</p>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Nom de l&apos;entreprise</span>
                <input className={field} value={f.tradeName} onChange={set("tradeName")} placeholder="GRACES JUMELLES HOUSE" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Nom du responsable</span>
                <input className={field} value={f.ownerName} onChange={set("ownerName")} autoComplete="name" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Téléphone</span>
                <input className={field} type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" placeholder="+229 …" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Adresse (facultatif)</span>
                <input className={field} value={f.address} onChange={set("address")} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Ville (facultatif)</span>
                <input className={field} value={f.city} onChange={set("city")} placeholder="Abomey-Calavi" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-700">IFU (facultatif)</span>
                  <input className={field} value={f.taxId} onChange={set("taxId")} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-700">RCCM (facultatif)</span>
                  <input className={field} value={f.tradeRegNumber} onChange={set("tradeRegNumber")} />
                </label>
              </div>
            </>
          )}

          <button type="submit" disabled={!ready || busy} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:bg-blue-300">
            {busy ? "Un instant…" : install ? "Créer mon espace" : "Enregistrer et me connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
