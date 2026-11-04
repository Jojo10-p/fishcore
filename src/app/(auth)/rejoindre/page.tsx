"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { APP_NAME } from "@/lib/app-config";

// « Créer mon compte » sans lien : on explique d'où vient le lien, et on peut le coller
export default function JoinPage() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const token = link.trim().split("/").filter(Boolean).pop() ?? "";
  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-br from-blue-50 to-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo GJH statique */}
          <img src="/icons/gjh-logo.png" alt="GRACES JUMELLES HOUSE" className="mx-auto mb-4 h-24 w-auto object-contain" />
          <h1 className="text-2xl font-bold text-gray-900">Créer mon compte</h1>
          <p className="text-sm text-gray-500 mt-1">{APP_NAME}</p>
        </div>
        <ol className="space-y-3 text-sm text-gray-700">
          <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">1</span>La direction vous envoie un lien d&apos;invitation (WhatsApp ou SMS).</li>
          <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">2</span>Vous ouvrez le lien : votre poste (caissier, gérant…) est déjà choisi.</li>
          <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">3</span>Vous créez votre compte avec Google ou avec un e-mail et un mot de passe.</li>
        </ol>
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.length >= 20) router.push(`/rejoindre/${token}`);
          }}
        >
          <label className="block text-sm font-medium text-gray-700">Vous avez reçu le lien ? Collez-le ici</label>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…/rejoindre/…"
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <button type="submit" disabled={token.length < 20} className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:bg-blue-300">
            Continuer
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-500">
          Déjà un compte ? <Link href="/login" className="font-medium text-blue-600 hover:underline">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
