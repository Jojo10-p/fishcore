import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { requireCustomer } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { Card, StatusBadge, Timeline, DocumentRow, KeyValue } from "@/components/client/shared";
import { UploadForm } from "@/components/client/upload-form";
import { formatDate, formatMoney, toNumber } from "@/lib/utils";
import { DOCUMENT_TYPES } from "@/lib/status";

export default async function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCustomer();
  const s = await getSettings();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const app = await db.loanApplication.findFirst({
    where: { id, customerId: user.customer.id, deletedAt: null },
    include: { product: true, statusHistory: { orderBy: { createdAt: "desc" } }, documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } }, documentRequests: { orderBy: { createdAt: "desc" } } },
  });
  if (!app) notFound();
  const money = (n: unknown, d = 0) => formatMoney(n, s.locale.currency, s.locale.numberLocale, d);
  const terms = app.termsSnapshot as { annualRate?: number; simulation?: { monthlyTotal: number; totalCost: number } };
  const pending = app.documentRequests.filter((r) => !r.fulfilledAt);
  const closed = app.status === "CLOSED";
  const comments = app.statusHistory.filter((h) => h.publicComment && h.fromStatus);

  return (
    <>
      <Link href="/espace/demandes" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ChevronLeft className="h-4 w-4" />Mes demandes</Link>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="tabular text-sm text-ink-faint">Dossier {app.reference}</p>
          <h1 className="mt-1 text-[1.9rem] font-extrabold leading-tight">{app.product.name}</h1>
          <p className="tabular mt-1 text-ink-soft">{money(app.amount)} sur {app.durationMonths} mois · déposé le {formatDate(app.createdAt)}</p>
        </div>
        <StatusBadge status={app.status} licensed={s.compliance.licensed} />
      </div>

      {pending.length > 0 && !closed && (
        <section className="mb-6 rounded-2xl border border-[#F1D9A8] bg-[#FDF6E7] p-5 sm:p-6">
          <p className="flex items-center gap-2 font-display font-bold text-[#7A4F0E]"><AlertTriangle className="h-5 w-5" />Documents complémentaires demandés</p>
          <ul className="mt-4 space-y-5">
            {pending.map((r) => (
              <li key={r.id} className="rounded-xl bg-white p-4">
                <p className="font-semibold">{r.label}</p>
                {r.message && <p className="mt-1 text-sm text-ink-soft">{r.message}</p>}
                <div className="mt-3">
                  <UploadForm requestId={r.id} applicationId={app.id} defaultType={Object.entries(DOCUMENT_TYPES).find(([, v]) => r.label.startsWith(v))?.[0] ?? "other"} compact />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {comments.length > 0 && (
            <Card title="Commentaires de l'analyste">
              <ul className="space-y-4">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-xl bg-paper p-4">
                    <p className="whitespace-pre-line text-[15px]">{c.publicComment}</p>
                    <p className="mt-2 text-xs text-ink-faint">{formatDate(c.createdAt, "fr-FR", true)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {app.decisionReason && <Card title="Motif communiqué"><p className="whitespace-pre-line">{app.decisionReason}</p></Card>}
          <Card title="Informations soumises">
            <KeyValue
              rows={[
                ["Offre", app.product.name],
                ["Montant demandé", money(app.amount)],
                ["Durée", `${app.durationMonths} mois`],
                ["Taux annuel au dépôt", terms.annualRate !== undefined ? `${terms.annualRate} %` : "—"],
                ["Mensualité estimée", terms.simulation ? money(terms.simulation.monthlyTotal, 2) : "—"],
                ["Coût total estimé", terms.simulation ? money(terms.simulation.totalCost, 2) : "—"],
                ["Objet", app.purpose],
                ["Revenus déclarés", money(toNumber((app.applicantSnapshot as { monthlyIncome?: number }).monthlyIncome))],
              ]}
            />
            <div className="mt-5 border-t border-night/[.06] pt-5">
              <p className="text-[13px] text-ink-faint">Description</p>
              <p className="mt-1 whitespace-pre-line text-[15px]">{app.description}</p>
            </div>
          </Card>
          <Card title={`Documents transmis (${app.documents.length})`}>
            {app.documents.length ? <ul className="-my-4 divide-y divide-night/[.06]">{app.documents.map((d) => <DocumentRow key={d.id} doc={d} />)}</ul> : <p className="text-sm text-ink-faint">Aucun document transmis.</p>}
            {!closed && <div className="mt-6 border-t border-night/[.06] pt-6"><p className="mb-3 text-sm font-semibold">Ajouter un document à ce dossier</p><UploadForm applicationId={app.id} /></div>}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Historique du traitement"><Timeline items={app.statusHistory} licensed={s.compliance.licensed} /></Card>
          <Card title="Une question ?">
            <p className="text-sm text-ink-soft">Un conseiller peut vous répondre sur ce dossier.</p>
            <Link href={`/espace/assistance/nouveau?dossier=${app.id}`} className="mt-3 inline-block text-sm font-semibold text-teal-700 hover:underline">Écrire à l'assistance</Link>
          </Card>
        </div>
      </div>
    </>
  );
}
