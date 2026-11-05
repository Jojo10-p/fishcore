"use client";

import { Suspense, useEffect, useState } from "react";
import { applyBrand, readBrand } from "@/lib/client/brand";
import { useForm } from "react-hook-form";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { APP_NAME } from "@/lib/app-config";
import { AUTH_ERRORS, GoogleButton } from "@/components/auth/google-button";

interface LoginForm {
  email: string;
  password: string;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Redirection interne uniquement (empêche une redirection vers un site externe)
  const requested = searchParams.get("redirect");
  const deleted = searchParams.get("compte") === "supprime";
  const redirect = requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";

  const [error, setError] = useState<string | null>(AUTH_ERRORS[searchParams.get("erreur") ?? ""] ?? null);
  const [isLoading, setIsLoading] = useState(false);
  // Application installée par une entreprise : on garde son nom et son logo
  useEffect(() => {
    const t = setTimeout(() => {
      const b = readBrand();
      if (b) applyBrand(b);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        setError(result.error ?? "Erreur de connexion");
        return;
      }

      // L'application prend le nom et le logo de l'entreprise
      if (result.data?.company?.id) {
        applyBrand({ companyId: result.data.company.id, name: result.data.company.appName || result.data.company.tradeName, logoUrl: result.data.company.logoUrl ?? null });
      }

      // Administrateur de la plateforme : son propre espace
      router.push(result.data?.user?.role === "PLATFORM_ADMIN" ? "/plateforme" : redirect);
      router.refresh();
    } catch {
      setError("Impossible de se connecter. Vérifiez votre connexion Internet.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-blue-50 to-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        {/* Logo / En-tête */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo GJH statique */}
          <img src="/icons/gjh-logo.png" alt="GRACES JUMELLES HOUSE" className="mx-auto mb-4 h-28 w-auto object-contain" />
          <h1 className="text-2xl font-bold text-gray-900">{APP_NAME}</h1>
          <p className="text-sm text-gray-500 mt-1">Connectez-vous à votre espace</p>
        </div>

        {deleted && (
          <div className="mb-5 p-3.5 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
            Le compte a été supprimé définitivement, avec toutes ses données.
          </div>
        )}

        {/* Erreur globale */}
        {error && (
          <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
            <span className="shrink-0 mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <GoogleButton />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Adresse email
            </label>
            <input
              type="email"
              autoComplete="email"
              placeholder="vous@entreprise.com"
              className={`w-full px-4 py-2.5 border rounded-xl text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.email
                  ? "border-red-300 bg-red-50"
                  : "border-gray-300 bg-white hover:border-gray-400"
              }`}
              {...register("email", {
                required: "Email requis",
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Email invalide" },
              })}
            />
            {errors.email && (
              <p className="mt-1.5 text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          {/* Mot de passe */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Mot de passe
            </label>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className={`w-full px-4 py-2.5 border rounded-xl text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.password
                  ? "border-red-300 bg-red-50"
                  : "border-gray-300 bg-white hover:border-gray-400"
              }`}
              {...register("password", { required: "Mot de passe requis" })}
            />
            {errors.password && (
              <p className="mt-1.5 text-xs text-red-600">{errors.password.message}</p>
            )}
            <div className="mt-1.5 text-right">
              <Link href="/mot-de-passe-oublie" className="text-xs text-blue-600 hover:underline">
                Mot de passe oublié ?
              </Link>
            </div>
          </div>

          {/* Bouton connexion */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Connexion en cours…
              </span>
            ) : (
              "Se connecter"
            )}
          </button>
        </form>

        {/* Créer un compte : avec le lien d'invitation de la direction */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Pas encore de compte ?{" "}
            <Link href="/register" className="text-blue-600 font-medium hover:underline">
              Créer un compte
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// useSearchParams() exige une frontière Suspense pour le rendu statique (Next.js 16)
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
