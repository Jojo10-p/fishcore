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

type Step = "email" | "password" | "code";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Redirection interne uniquement (empêche une redirection vers un site externe)
  const requested = searchParams.get("redirect");
  const deleted = searchParams.get("compte") === "supprime";
  const redirect = requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";

  const [error, setError] = useState<string | null>(AUTH_ERRORS[searchParams.get("erreur") ?? ""] ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<Step>("email");
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(0);
  // Application installée par une entreprise : on garde son nom et son logo
  useEffect(() => {
    const t = setTimeout(() => {
      const b = readBrand();
      if (b) applyBrand(b);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  // Délai avant de pouvoir redemander un code
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginForm>();

  const finish = (result: { data?: { user?: { role?: string }; company?: { id: string; appName?: string; tradeName: string; logoUrl?: string | null } } }) => {
    // L'application prend le nom et le logo de l'entreprise
    if (result.data?.company?.id) {
      applyBrand({ companyId: result.data.company.id, name: result.data.company.appName || result.data.company.tradeName, logoUrl: result.data.company.logoUrl ?? null });
    }
    // Administrateur de la plateforme : son propre espace
    router.push(result.data?.user?.role === "PLATFORM_ADMIN" ? "/plateforme" : redirect);
    router.refresh();
  };

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, result: await res.json().catch(() => ({})) };
  };

  /** 1re étape : l'adresse décide entre code par e-mail et mot de passe */
  const askCode = async (email: string) => {
    const { ok, result } = await post("/api/auth/code/request", { email });
    if (result?.data?.mode === "password") {
      setStep("password");
      return;
    }
    if (result?.data?.mode === "code") {
      setStep("code");
      setWait(result.data.wait ?? 60);
    }
    if (!ok || !result.success) setError(result.error ?? "Erreur de connexion");
  };

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setError(null);
    try {
      if (step === "email") return await askCode(data.email);
      if (step === "code") {
        const { ok, result } = await post("/api/auth/code/verify", { email: data.email, code });
        if (!ok || !result.success) return setError(result.error ?? "Code invalide");
        return finish(result);
      }
      const { ok, result } = await post("/api/auth/login", data);
      if (!ok || !result.success) {
        if (result.code === "USE_EMAIL_CODE") return await askCode(data.email);
        return setError(result.error ?? "Erreur de connexion");
      }
      finish(result);
    } catch {
      setError("Impossible de se connecter. Vérifiez votre connexion Internet.");
    } finally {
      setIsLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await askCode(getValues("email"));
    } finally {
      setIsLoading(false);
    }
  };

  const changeEmail = () => {
    setStep("email");
    setCode("");
    setError(null);
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
              readOnly={step !== "email"}
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

          {step !== "email" && (
            <div className="-mt-3 text-right">
              <button type="button" onClick={changeEmail} className="text-xs text-blue-600 hover:underline">
                Changer d&apos;adresse
              </button>
            </div>
          )}

          {/* Mot de passe */}
          {step === "password" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Mot de passe
              </label>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                placeholder="••••••••"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.password
                    ? "border-red-300 bg-red-50"
                    : "border-gray-300 bg-white hover:border-gray-400"
                }`}
                {...register("password", { required: step === "password" ? "Mot de passe requis" : false })}
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
          )}

          {/* Code reçu par e-mail (super administrateur) */}
          {step === "code" && (
            <div>
              <p className="mb-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
                Un code à 8 caractères vient d&apos;être envoyé à cette adresse. Il est valable 10 minutes.
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Code reçu par e-mail</label>
              <input
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoFocus
                maxLength={9}
                placeholder="XXXX XXXX"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-center text-xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="mt-1.5 text-right">
                <button type="button" onClick={() => void resend()} disabled={wait > 0 || isLoading} className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline">
                  {wait > 0 ? `Renvoyer le code (${wait} s)` : "Renvoyer le code"}
                </button>
              </div>
            </div>
          )}

          {/* Bouton connexion */}
          <button
            type="submit"
            disabled={isLoading || (step === "code" && code.replace(/[^A-Z0-9]/g, "").length < 8)}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {step === "email" ? "Vérification…" : "Connexion en cours…"}
              </span>
            ) : step === "email" ? (
              "Continuer"
            ) : (
              "Se connecter"
            )}
          </button>
        </form>

        {/* Accueil : se connecter, créer un compte, ou se rattacher au compte du patron */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Link href="/register" className="rounded-xl border border-gray-300 px-3 py-3 text-center text-sm font-semibold text-gray-800 hover:bg-gray-50">
            Créer un compte
          </Link>
          <Link href="/rejoindre" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-center text-sm font-semibold text-amber-900 hover:bg-amber-100">
            Me rattacher avec un code
          </Link>
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
