"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BUSINESS_PROFILES, BUSINESS_TYPE_ORDER } from "@/lib/business-profiles";
import { applyBrand } from "@/lib/client/brand";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface StepOneData {
  businessType: string;
  tradeName: string;
  ownerName: string;
  phone: string;
  email: string;
  address?: string;
  city?: string;
  country: string;
  taxId?: string;
  tradeRegNumber?: string;
  currency: string;
}
interface StepTwoData {
  password: string;
  confirmPassword: string;
}

const TOTAL_STEPS = 3;
const STORAGE_KEY = "fishcore-register-draft";

// ─────────────────────────────────────────────
// Barre de progression
// ─────────────────────────────────────────────
function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div key={i} className="flex items-center flex-1">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
              i < step
                ? "bg-blue-600 text-white"
                : i === step
                ? "bg-blue-100 text-blue-600 border-2 border-blue-600"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {i < step ? "✓" : i + 1}
          </div>
          {i < TOTAL_STEPS - 1 && (
            <div
              className={`flex-1 h-1 mx-1 rounded-full transition-all ${
                i < step ? "bg-blue-600" : "bg-gray-200"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────
export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [step1Data, setStep1Data] = useState<StepOneData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  // Arrivée après une suppression de compte
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDeleted(new URLSearchParams(window.location.search).get("compte") === "supprime"), 0);
    return () => clearTimeout(t);
  }, []);

  // Restaurer le brouillon
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.step1) setStep1Data(draft.step1);
        if (draft.currentStep) setStep(draft.currentStep);
      }
    } catch {}
  }, []);

  const saveDraft = (data: Partial<{ step1: StepOneData; currentStep: number }>) => {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...data }));
    } catch {}
  };

  // ─── Étape 1 ───
  const Step1 = () => {
    const { register, handleSubmit, watch, formState: { errors } } = useForm<StepOneData>({
      defaultValues: step1Data ?? {
        businessType: "GENERAL",
        country: "BJ",
        currency: "XOF",
        city: "Cotonou",
      },
    });

    const watchAll = watch();
    useEffect(() => {
      const timeout = setTimeout(() => saveDraft({ step1: watchAll }), 500);
      return () => clearTimeout(timeout);
    }, [watchAll]);

    const onNext = (data: StepOneData) => {
      setStep1Data(data);
      saveDraft({ step1: data, currentStep: 1 });
      setStep(1);
    };

    return (
      <form onSubmit={handleSubmit(onNext)} className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Votre activité</h2>
        <p className="text-sm text-gray-500 -mt-2">
          Nous préparons les unités, catégories et options adaptées. Tout reste modifiable ensuite.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {BUSINESS_TYPE_ORDER.map((type) => {
            const p = BUSINESS_PROFILES[type];
            const selected = watchAll.businessType === type;
            return (
              <label
                key={type}
                className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm transition-colors ${selected ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
              >
                <input type="radio" value={type} className="sr-only" {...register("businessType")} />
                <span className="text-xl leading-none" aria-hidden>{p.icon}</span>
                <span>
                  <span className="block font-medium text-gray-900">{p.label}</span>
                  <span className="block text-xs text-gray-500">{p.description}</span>
                </span>
              </label>
            );
          })}
        </div>

        <h2 className="text-lg font-semibold text-gray-900 pt-2">Informations de l&apos;entreprise</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom commercial <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="ex. Établissements Atchavé"
              className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.tradeName ? "border-red-300" : "border-gray-300"}`}
              {...register("tradeName", { required: "Nom commercial requis" })}
            />
            {errors.tradeName && <p className="mt-1 text-xs text-red-600">{errors.tradeName.message}</p>}
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom du propriétaire <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Prénom et nom"
              className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.ownerName ? "border-red-300" : "border-gray-300"}`}
              {...register("ownerName", { required: "Nom du propriétaire requis" })}
            />
            {errors.ownerName && <p className="mt-1 text-xs text-red-600">{errors.ownerName.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Téléphone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              placeholder="+229 97 000 000"
              className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.phone ? "border-red-300" : "border-gray-300"}`}
              {...register("phone", { required: "Téléphone requis", minLength: { value: 8, message: "Numéro invalide" } })}
            />
            {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              placeholder="contact@entreprise.com"
              className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.email ? "border-red-300" : "border-gray-300"}`}
              {...register("email", {
                required: "Email requis",
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Email invalide" },
              })}
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
            <input
              type="text"
              placeholder="Quartier, rue..."
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register("address")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ville</label>
            <input
              type="text"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register("city")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pays</label>
            <select
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register("country")}
            >
              <option value="BJ">Bénin</option>
              <option value="TG">Togo</option>
              <option value="CI">Côte d&apos;Ivoire</option>
              <option value="SN">Sénégal</option>
              <option value="CM">Cameroun</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">IFU (optionnel)</label>
            <input
              type="text"
              placeholder="Numéro IFU"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register("taxId")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">RCCM (optionnel)</label>
            <input
              type="text"
              placeholder="Numéro RCCM"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register("tradeRegNumber")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Devise</label>
            <select
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register("currency")}
            >
              <option value="XOF">XOF — Franc CFA BCEAO</option>
              <option value="GNF">GNF — Franc guinéen</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Suivant →
        </button>
      </form>
    );
  };

  // ─── Étape 2 : Mot de passe ───
  const Step2 = () => {
    const { register, handleSubmit, watch, formState: { errors } } = useForm<StepTwoData>();

    const onNext = (data: StepTwoData) => {
      if (data.password !== data.confirmPassword) return;
      saveDraft({ currentStep: 2 });
      handleFinalSubmit(data);
    };

    return (
      <form onSubmit={handleSubmit(onNext)} className="space-y-5">
        <h2 className="text-lg font-semibold text-gray-900">Sécurité du compte</h2>
        <p className="text-sm text-gray-500">
          Ce mot de passe protège l&apos;accès à votre espace propriétaire.
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Mot de passe <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            placeholder="Min. 8 caractères, 1 majuscule, 1 chiffre"
            className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.password ? "border-red-300" : "border-gray-300"}`}
            {...register("password", {
              required: "Mot de passe requis",
              minLength: { value: 8, message: "Min. 8 caractères" },
              pattern: { value: /(?=.*[A-Z])(?=.*[0-9])/, message: "Au moins 1 majuscule et 1 chiffre" },
            })}
          />
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Confirmer le mot de passe <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            placeholder="Répétez le mot de passe"
            className={`w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.confirmPassword ? "border-red-300" : "border-gray-300"}`}
            {...register("confirmPassword", {
              required: "Confirmation requise",
              validate: (v) => v === watch("password") || "Les mots de passe ne correspondent pas",
            })}
          />
          {errors.confirmPassword && (
            <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep(0)}
            className="flex-1 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50"
          >
            ← Retour
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            {isSubmitting ? "Création…" : "Créer mon compte →"}
          </button>
        </div>
      </form>
    );
  };

  // ─── Soumission finale ───
  const handleFinalSubmit = async (step2: StepTwoData) => {
    if (!step1Data) return;
    setIsSubmitting(true);
    setGlobalError(null);
    setStep(2);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...step1Data, ...step2 }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        setGlobalError(result.error ?? "Erreur lors de la création du compte");
        setStep(1);
        return;
      }

      // Nettoyer le brouillon
      localStorage.removeItem(STORAGE_KEY);

      // Auto-login
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: step1Data.email, password: step2.password }),
      });
      if (loginRes.ok) {
        // L'application prend tout de suite le nom de l'entreprise
        const login = await loginRes.json().catch(() => null);
        const company = login?.data?.company;
        if (company?.id) applyBrand({ companyId: company.id, name: company.tradeName, logoUrl: company.logoUrl ?? null });
        router.push("/onboarding");
      } else {
        router.push("/login");
      }
    } catch {
      setGlobalError("Erreur réseau. Vérifiez votre connexion.");
      setStep(1);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-blue-50 to-gray-50 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-2xl mb-3 shadow-lg">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Créer mon espace</h1>
          <p className="text-sm text-gray-500 mt-0.5">Configuration initiale de votre entreprise</p>
        </div>
        {deleted && (
          <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-3.5 text-sm text-green-800">
            Votre compte et toutes ses données ont été supprimés. Vous pouvez créer un nouvel espace, avec la même adresse e-mail si vous le souhaitez.
          </div>
        )}

        <ProgressBar step={step} />

        {globalError && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            ⚠️ {globalError}
          </div>
        )}

        {step === 0 && <Step1 />}
        {step === 1 && <Step2 />}
        {step === 2 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">
              {isSubmitting ? "⏳" : "✅"}
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              {isSubmitting ? "Création en cours…" : "Compte créé !"}
            </h3>
            <p className="text-sm text-gray-500 mt-2">
              {isSubmitting
                ? "Veuillez patienter quelques secondes."
                : "Redirection vers la configuration initiale…"}
            </p>
          </div>
        )}

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Déjà un compte ?{" "}
            <Link href="/login" className="text-blue-600 font-medium hover:underline">
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
