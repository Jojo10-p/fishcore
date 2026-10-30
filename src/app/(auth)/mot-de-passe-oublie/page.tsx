"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readBrand } from "@/lib/client/brand";
import { SUPPORT_CONTACT } from "@/lib/app-config";

// Sans e-mail : le responsable génère un lien personnel (Utilisateurs → 🔑),
// le propriétaire passe par le support de la plateforme.
export default function ForgotPasswordPage() {
  const [company, setCompany] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setCompany(readBrand()?.name ?? null), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8 space-y-5">
        <div className="text-center">
          <div className="text-4xl mb-2" aria-hidden>
            🔑
          </div>
          <h1 className="text-xl font-bold text-gray-900">Mot de passe oublié</h1>
          {company && <p className="text-sm text-gray-500 mt-1">{company}</p>}
        </div>
        <div className="space-y-3 text-sm text-gray-700">
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
            <p className="font-semibold text-gray-900">Vous êtes employé (caisse, magasin, comptabilité…)</p>
            <p className="mt-1">
              Demandez à votre responsable : dans <strong>Utilisateurs</strong>, il clique sur <strong>🔑 Mot de passe</strong> à côté de votre nom et vous envoie un
              lien par WhatsApp ou SMS. Vous choisissez alors vous-même votre nouveau mot de passe.
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
            <p className="font-semibold text-gray-900">Vous êtes le propriétaire</p>
            <p className="mt-1">
              Un autre propriétaire de votre entreprise peut vous envoyer ce lien. Sinon, contactez l&apos;assistance
              {SUPPORT_CONTACT ? (
                <>
                  {" "}
                  : <strong>{SUPPORT_CONTACT}</strong>
                </>
              ) : null}{" "}
              avec l&apos;adresse e-mail de votre compte ; vous recevrez un lien de réinitialisation après vérification de votre identité.
            </p>
          </div>
        </div>
        <p className="text-center">
          <Link href="/login" className="text-sm text-blue-600 font-medium hover:underline">
            ← Retour à la connexion
          </Link>
        </p>
      </div>
    </div>
  );
}
