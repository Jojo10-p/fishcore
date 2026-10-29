"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface InstallConfig {
  companyName: string;
  centerName: string;
  centerCode: string;
  logoUrl?: string;
  currency: string;
  cashRegisters: Array<{ id: string; name: string }>;
  companyId: string;
  centerId: string;
}

type InstallStep = "verifying" | "confirmed" | "installing" | "done" | "error";

export default function InstallPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  void searchParams; // le jeton est lu côté client (window.location)
  return <InstallClientPage />;
}

function InstallClientPage() {
  const [step, setStep] = useState<InstallStep>("verifying");
  const [config, setConfig] = useState<InstallConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const [hasVerified, setHasVerified] = useState(false);

  const verifyToken = async (t: string) => {
    try {
      const res = await fetch(`/api/install?token=${encodeURIComponent(t)}`);
      const result = await res.json();

      if (!res.ok || !result.success) {
        setStep("error");
        setError(result.error ?? "Lien invalide ou expiré");
        return;
      }

      setConfig(result.data);
      setStep("confirmed");
    } catch {
      setStep("error");
      setError("Erreur réseau lors de la vérification du lien.");
    }
  };

  // Extraire le token de l'URL au montage (jamais de setState pendant le rendu)
  useEffect(() => {
    if (hasVerified) return;
    const timer = setTimeout(() => {
      setHasVerified(true);
      const t = new URLSearchParams(window.location.search).get("token");
      if (t) {
        setToken(t);
        void verifyToken(t);
      } else {
        setStep("error");
        setError("Lien d'installation invalide. Aucun token fourni.");
      }
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstall = async () => {
    if (!config || !token) return;
    setStep("installing");

    try {
      // Marquer le lien comme utilisé
      const res = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, deviceId: getDeviceId() }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        setStep("error");
        setError(result.error ?? "Ce lien n'est plus valide.");
        return;
      }

      // Stocker la config localement (pour le mode offline)
      localStorage.setItem("fishcore-agency-config", JSON.stringify({
        ...config,
        installedAt: new Date().toISOString(),
      }));
      localStorage.setItem("fishcore-company-name", config.companyName);
      localStorage.setItem("fishcore-center-id", config.centerId);
      localStorage.setItem("fishcore-company-id", config.companyId);

      setStep("done");
    } catch {
      setStep("error");
      setError("Erreur lors de l'installation. Réessayez.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-teal-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 w-full max-w-md">

        {/* Vérification en cours */}
        {step === "verifying" && (
          <div className="text-center py-8">
            <div className="text-4xl mb-4 animate-pulse">🔍</div>
            <h2 className="text-lg font-semibold text-gray-900">Vérification du lien…</h2>
            <p className="text-sm text-gray-500 mt-2">Validation en cours, veuillez patienter.</p>
          </div>
        )}

        {/* Lien confirmé — prêt à installer */}
        {step === "confirmed" && config && (
          <>
            <div className="text-center mb-6">
              {config.logoUrl ? (
                <img src={config.logoUrl} alt={config.companyName} className="w-16 h-16 rounded-xl mx-auto mb-3 object-contain shadow" />
              ) : (
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-3 shadow-lg">
                  <img src="/icons/icon.svg" alt="" className="h-8 w-8" />
                </div>
              )}
              <h1 className="text-xl font-bold text-gray-900">{config.companyName}</h1>
              <p className="text-sm text-gray-500 mt-1">Installation du logiciel de caisse</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Centre / Agence</span>
                <span className="font-semibold text-gray-900">{config.centerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Code</span>
                <span className="font-mono text-gray-900">{config.centerCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Caisses disponibles</span>
                <span className="font-semibold text-gray-900">{config.cashRegisters.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Devise</span>
                <span className="font-semibold text-gray-900">{config.currency}</span>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-6 text-xs text-blue-700">
              ℹ️ Ce lien est à usage unique. Une fois installé, les paramètres de l&apos;agence seront
              synchronisés automatiquement depuis le portail principal.
            </div>

            <button
              onClick={handleInstall}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              Installer et configurer cette agence
            </button>
          </>
        )}

        {/* Installation en cours */}
        {step === "installing" && (
          <div className="text-center py-8">
            <div className="text-4xl mb-4 animate-bounce">⚙️</div>
            <h2 className="text-lg font-semibold text-gray-900">Installation en cours…</h2>
            <p className="text-sm text-gray-500 mt-2">
              Configuration de l&apos;agence et synchronisation des données.
            </p>
          </div>
        )}

        {/* Installation terminée */}
        {step === "done" && (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-bold text-gray-900">Installation réussie !</h2>
            <p className="text-sm text-gray-500 mt-2 mb-6">
              L&apos;agence est configurée. Connectez-vous pour commencer.
            </p>
            <Link
              href="/login"
              className="inline-block w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors text-center"
            >
              Se connecter →
            </Link>
          </div>
        )}

        {/* Erreur */}
        {step === "error" && (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">❌</div>
            <h2 className="text-lg font-semibold text-gray-900">Lien invalide</h2>
            <p className="text-sm text-red-600 mt-2">{error}</p>
            <p className="text-xs text-gray-500 mt-3">
              Demandez un nouveau lien d&apos;installation à votre administrateur.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function getDeviceId(): string {
  let id = localStorage.getItem("fishcore-device-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("fishcore-device-id", id);
  }
  return id;
}
