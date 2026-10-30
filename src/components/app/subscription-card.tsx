"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Card, Spinner } from "@/components/ui";
import { apiGet, errorMessage } from "@/lib/client/api";

interface Sub {
  status: "TRIAL" | "ACTIVE" | "GRACE" | "EXPIRED" | "SUSPENDED";
  accessEndsAt: string | null;
  readOnlyFrom: string | null;
  daysLeft: number | null;
  graceDays: number;
  trialEndsAt: string | null;
  paidUntil: string | null;
  plan: { code: string; name: string };
  limits: { maxCenters: number | null; maxUsers: number | null };
  usage: { centers: number; users: number };
  payments: Array<{ id: string; createdAt: string; planCode: string; amount: number; months: number; method: string; reference: string | null; periodStart: string; periodEnd: string }>;
  plans: Array<{ code: string; name: string; monthlyPrice: number; maxCenters: number | null; maxUsers: number | null; description: string | null }>;
  paymentInstructions: string | null;
  supportContact: string | null;
}

const LABEL: Record<Sub["status"], { text: string; tone: "blue" | "green" | "amber" | "red" | "gray" }> = {
  TRIAL: { text: "Essai gratuit", tone: "blue" },
  ACTIVE: { text: "Abonnement actif", tone: "green" },
  GRACE: { text: "Échéance dépassée", tone: "amber" },
  EXPIRED: { text: "Consultation seule", tone: "red" },
  SUSPENDED: { text: "Suspendu", tone: "gray" },
};
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F CFA`;

/** Abonnement de l'entreprise : offre, échéance, utilisation, paiement, historique. */
export function SubscriptionCard() {
  const [s, setS] = useState<Sub | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ data: Sub }>("/api/company/subscription")
      .then((r) => setS(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!s) return <Card className="p-4 sm:p-6"><Spinner /></Card>;
  const l = LABEL[s.status];

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div id="abonnement" className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">Abonnement</h2>
          <p className="text-sm text-gray-500">
            Offre <strong>{s.plan.name}</strong> ·{" "}
            {s.status === "TRIAL"
              ? `essai jusqu'au ${day(s.trialEndsAt)}`
              : s.paidUntil
                ? `payé jusqu'au ${day(s.paidUntil)}`
                : `échéance ${day(s.accessEndsAt)}`}
            {s.daysLeft !== null && s.daysLeft >= 0 && s.status !== "EXPIRED" ? ` (${s.daysLeft} jour${s.daysLeft > 1 ? "s" : ""})` : ""}
          </p>
        </div>
        <Badge tone={l.tone}>{l.text}</Badge>
      </div>

      {s.status === "GRACE" && (
        <Alert tone="amber">
          L&apos;échéance du {day(s.accessEndsAt)} est dépassée. Tout fonctionne encore jusqu&apos;au <strong>{day(s.readOnlyFrom)}</strong> ; ensuite l&apos;application passera en
          consultation seule (plus de ventes ni de saisies) jusqu&apos;au renouvellement.
        </Alert>
      )}
      {s.status === "EXPIRED" && (
        <Alert>
          Consultation seule depuis le {day(s.readOnlyFrom)} : vos données restent consultables et exportables, les ventes reprennent dès le renouvellement.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Centres actifs</p>
          <p className="font-semibold">
            {s.usage.centers} / {s.limits.maxCenters ?? "illimité"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Utilisateurs actifs</p>
          <p className="font-semibold">
            {s.usage.users} / {s.limits.maxUsers ?? "illimité"}
          </p>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900">Offres</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {s.plans.map((p) => (
            <div key={p.code} className={`rounded-lg border p-3 text-sm ${p.code === s.plan.code ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
              <p className="font-semibold text-gray-900">{p.name}</p>
              <p className="text-gray-900">{fcfa(p.monthlyPrice)} / mois</p>
              <p className="text-xs text-gray-500">
                {p.maxCenters ?? "∞"} centre(s) · {p.maxUsers ?? "∞"} utilisateur(s)
              </p>
              {p.description && <p className="mt-1 text-xs text-gray-500">{p.description}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
        <p className="font-medium text-gray-900">Pour payer ou changer d&apos;offre</p>
        <p className="mt-1 whitespace-pre-line">
          {s.paymentInstructions ?? "Contactez l'assistance pour recevoir les coordonnées de paiement (Mobile Money, virement)."}
        </p>
        {s.supportContact && <p className="mt-1">Assistance : {s.supportContact}</p>}
        <p className="mt-1 text-xs text-gray-500">Le paiement est enregistré dès réception : l&apos;abonnement est prolongé sans interruption.</p>
      </div>

      {s.payments.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-900">Paiements</p>
          <ul className="mt-1 divide-y divide-gray-100 text-sm">
            {s.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 py-1.5">
                <span>
                  {day(p.createdAt)} · {s.plans.find((x) => x.code === p.planCode)?.name ?? p.planCode} · {p.months} mois
                  <span className="text-gray-500">
                    {" "}
                    ({day(p.periodStart)} → {day(p.periodEnd)})
                  </span>
                </span>
                <span className="font-medium">{fcfa(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Bandeau d'échéance en haut de l'application. */
export function SubscriptionBanner({ sub, canManage }: { sub: { status: Sub["status"]; daysLeft: number | null; readOnlyFrom: string | null } | null | undefined; canManage: boolean }) {
  if (!sub) return null;
  const link = canManage ? (
    <a href="/parametres#abonnement" className="ml-1 font-semibold underline">
      Voir l&apos;abonnement
    </a>
  ) : (
    <span className="ml-1">Prévenez le responsable de l&apos;entreprise.</span>
  );
  if (sub.status === "EXPIRED") {
    return (
      <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 lg:mx-8">
        Abonnement échu : l&apos;application est en <strong>consultation seule</strong> (plus de ventes ni de saisies).{link}
      </div>
    );
  }
  if (sub.status === "GRACE") {
    return (
      <div className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 lg:mx-8">
        Échéance de l&apos;abonnement dépassée : consultation seule à partir du <strong>{day(sub.readOnlyFrom)}</strong> sans renouvellement.{link}
      </div>
    );
  }
  if ((sub.status === "TRIAL" || sub.status === "ACTIVE") && sub.daysLeft !== null && sub.daysLeft <= (sub.status === "TRIAL" ? 5 : 7)) {
    return (
      <div className="mx-4 mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 lg:mx-8">
        {sub.status === "TRIAL" ? "Essai gratuit" : "Abonnement"} : {sub.daysLeft <= 0 ? "se termine aujourd'hui" : `encore ${sub.daysLeft} jour${sub.daysLeft > 1 ? "s" : ""}`}.{link}
      </div>
    );
  }
  return null;
}
