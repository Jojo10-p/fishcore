"use client";

import { useSession } from "@/components/app/session-provider";
import { Card, PageHeader } from "@/components/ui";

// Espace e-MECeF (facture normalisée DGI) — gérant et direction.
// En attendant l'agrément de la DGI, l'écran est présenté flouté avec « En développement ».
// Ce qu'il affichera : factures normalisées émises, avoirs, taxes (TVA, AIB) par période,
// factures en attente d'envoi, état de la connexion et du jeton DGI.

const PREVIEW: Array<[string, string, string]> = [
  ["🧾", "Factures normalisées", "1 284"],
  ["↩️", "Avoirs (annulations)", "12"],
  ["⏳", "En attente d'envoi", "0"],
  ["💰", "Chiffre d'affaires déclaré", "18 450 000 F"],
  ["🏛️", "TVA collectée (18 %)", "2 814 400 F"],
  ["📑", "AIB", "0 F"],
];

export default function MecefPage() {
  const { session } = useSession();
  const allowed = session?.user.role === "COMPANY_OWNER" || session?.user.role === "CENTER_MANAGER";
  if (session && !allowed) {
    return <p className="p-6 text-sm text-gray-600">Réservé au gérant et à la direction.</p>;
  }
  return (
    <>
      <PageHeader title="e-MECeF — Facture normalisée" description="Tout ce qui concerne la DGI : factures normalisées, taxes et impôts de l'entreprise." />
      <div className="relative">
        {/* Aperçu flouté de ce qui arrive */}
        <div aria-hidden className="pointer-events-none select-none blur-[6px]">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {PREVIEW.map(([icon, label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-2xl">{icon}</p>
                <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">{label}</p>
                <p className="text-xl font-bold text-gray-900">{value}</p>
              </Card>
            ))}
          </div>
          <Card className="mt-4 p-4">
            <p className="font-semibold">Impôts et taxes à payer</p>
            <div className="mt-3 space-y-2">
              {["TVA de novembre — à déclarer avant le 10/12", "AIB du mois", "Impôt sur les bénéfices (acompte)"].map((t) => (
                <div key={t} className="flex justify-between rounded-lg bg-gray-50 p-3 text-sm">
                  <span>{t}</span>
                  <span className="font-semibold">— F</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="mt-4 h-48 p-4">
            <p className="font-semibold">Ventes normalisées par jour</p>
          </Card>
        </div>

        {/* Fenêtre « En développement » */}
        <div className="absolute inset-0 flex items-start justify-center p-4 pt-20">
          <div className="w-full max-w-xs rounded-2xl border border-gray-200 bg-white px-6 py-8 text-center shadow-2xl">
            <p className="text-6xl" aria-hidden>
              🧑‍💻
            </p>
            <p className="mt-3 text-2xl" aria-hidden>
              🚧
            </p>
            <h2 className="mt-2 text-xl font-bold text-gray-900">En développement</h2>
          </div>
        </div>
      </div>
    </>
  );
}
