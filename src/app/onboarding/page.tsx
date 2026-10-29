"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";

interface OnboardingData {
  centerName: string;
  centerCode: string;
  centerAddress?: string;
  centerCity?: string;
  centerPhone?: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<"center" | "products" | "done">("center");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<OnboardingData>({
    defaultValues: { centerCity: "Cotonou", centerCode: "SIEG" },
  });

  const handleCenterSubmit = async (data: OnboardingData) => {
    setIsLoading(true);
    setError(null);
    try {
      // Récupérer l'user courant
      const meRes = await fetch("/api/auth/logout", { method: "GET" }).catch(() => null);
      // Appeler /api/auth/me
      const me = await fetch("/api/auth/logout").catch(() => null);

      // Créer le centre via l'API
      const res = await fetch("/api/centers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.centerName,
          code: data.centerCode.toUpperCase(),
          address: data.centerAddress,
          city: data.centerCity,
          phone: data.centerPhone,
          // companyId et createdById sont récupérés côté serveur via le cookie
          companyId: "from-session", // Le middleware injecte x-company-id
          createdById: "from-session",
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        setError(result.error ?? "Erreur lors de la création du centre");
        return;
      }

      setCenterId(result.data.id);
      setStep("done");
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      setIsLoading(false);
    }
  };

  if (step === "done") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-teal-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 w-full max-w-md text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900">Configuration terminée !</h2>
          <p className="text-gray-500 mt-3 text-sm">
            Votre premier centre de vente est créé. Vous pouvez maintenant commencer à utiliser votre logiciel.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-6 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            Accéder au tableau de bord →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-teal-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 w-full max-w-lg">
        {/* En-tête */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-teal-500 rounded-2xl mb-4 shadow-lg">
            <span className="text-2xl">🏪</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Configuration initiale</h1>
          <p className="text-sm text-gray-500 mt-1">
            Créez votre premier centre de vente pour commencer
          </p>
        </div>

        {/* Indicateur étape */}
        <div className="flex items-center justify-center gap-2 mb-7">
          <div className="flex items-center gap-2 text-xs font-medium text-blue-600">
            <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">1</div>
            Créer un centre
          </div>
          <div className="w-8 h-px bg-gray-200" />
          <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
            <div className="w-6 h-6 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center text-xs">2</div>
            Tableau de bord
          </div>
        </div>

        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit(handleCenterSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nom du centre / agence <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="ex. Siège principal, Marché Dantokpa..."
              className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.centerName ? "border-red-300" : "border-gray-300"}`}
              {...register("centerName", { required: "Nom requis" })}
            />
            {errors.centerName && <p className="mt-1 text-xs text-red-600">{errors.centerName.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Code interne <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="SIEG"
              maxLength={10}
              className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase ${errors.centerCode ? "border-red-300" : "border-gray-300"}`}
              {...register("centerCode", {
                required: "Code requis",
                pattern: { value: /^[A-Z0-9_-]+$/i, message: "Lettres, chiffres, tirets uniquement" },
                minLength: { value: 2, message: "Min. 2 caractères" },
              })}
            />
            <p className="mt-1 text-xs text-gray-400">Court identifiant unique (ex: SIEG, MKT1, NORD)</p>
            {errors.centerCode && <p className="mt-1 text-xs text-red-600">{errors.centerCode.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Ville</label>
              <input
                type="text"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                {...register("centerCity")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Téléphone</label>
              <input
                type="tel"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                {...register("centerPhone")}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Adresse</label>
            <input
              type="text"
              placeholder="Quartier, rue, localisation..."
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register("centerAddress")}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            {isLoading ? "Création en cours…" : "Créer ce centre et continuer →"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="w-full py-2 text-gray-500 text-sm hover:text-gray-700"
          >
            Passer cette étape (configurer plus tard)
          </button>
        </form>
      </div>
    </div>
  );
}
