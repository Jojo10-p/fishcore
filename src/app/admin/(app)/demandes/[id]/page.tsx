import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download, Info } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { Card, StatusBadge, DocumentRow, KeyValue } from "@/components/client/shared";
import { StatusForm, RequestDocForm, DocReview, AssignSelect, CancelRequestButton, PrintButton } from "@/components/admin/application-actions";
import { ReplyForm } from "@/components/client/reply-form";
import { addInternalNote } from "@/server/actions/admin/applications";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { APPLICATION_STATUS_META } from "@/lib/status";
import { formatDate, formatMoney, toNumber, initials } from "@/lib/utils";

export const metadata = { title: "Dossier" };

export default async function AdminApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireStaff("applications.view");
  const settings = await getSettings();
  const app = await db.loanApplication.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { include: { user: true, _count: { select: { applications: true } } } },
      product: true,
      assignedTo: true,
      statusHistory: { orderBy: { createdAt: "desc" }, include: { actor: true } },
      internalNotes: { orderBy: { createdAt: "desc" }, include: { author: true } },
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      documentRequests: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!app) notFound();
  const agents = user.can("applications.update")
    ? (await db.user.findMany({ where: { type: "STAFF", status: "ACTIVE", deletedAt: null, role: { permissions: { some: { key: "applications.update" } } } }, orderBy: { lastName: "asc" } })).map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}` }))
    : [];

  const money = (n: unknown, d = 0) => formatMoney(n, settings.locale.currency, settings.locale.numberLocale, d);
  const snap = app.applicantSnapshot as Record<string, string | number | null>;
  const terms = app.termsSnapshot as { annualRate?: number; feesFixed?: number; feesPercent?: number; insuranceRate?: number; simulation?: { monthlyTotal: number; totalCost: number; totalInterest: number; totalRepaid: number } };
  const income = toNumber(snap.monthlyIncome ?? app.customer.monthlyIncome);
  const charges = toNumber(snap.monthlyCharges ?? app.customer.monthlyCharges);
  const monthly = terms.simulation?.monthlyTotal ?? 0;
  const ratio = income > 0 ? ((charges + monthly) / income) * 100 : null;
  const remaining = income - charges - monthly;
  const canUpdate = user.can("applications.update");
  const pendingRequests = app.documentRequests.filter((r) => !r.fulfilledAt);

  return (
    <>
      <Link href="/admin/demandes" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink print:hidden"><ChevronLeft className="h-4 w-4" />Demandes</Link>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="tabular text-sm text-ink-faint">{app.reference}</p>
            <StatusBadge status={app.status} licensed={settings.compliance.licensed} />
            {app.isDemo && <Badge tone="champagne">Démonstration</Badge>}
          </div>
          <h1 className="mt-2 text-[1.9rem] font-extrabold leading-tight">{app.customer.firstName} {app.customer.lastName}</h1>
          <p className="tabular mt-1 text-ink-soft">{app.product.name} · {money(app.amount)} sur {app.durationMonths} mois · déposé le {formatDate(app.createdAt, "fr-FR", true)}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          {user.can("applications.export") && <a href={`/api/admin/applications/${app.id}/export`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" />Exporter le dossier</a>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* Synthèse financière */}
          <section className="overflow-hidden rounded-2xl bg-night text-white">
            <div className="grid grid-cols-2 gap-px bg-white/10 md:grid-cols-4">
              {[
                ["Montant", money(app.amount)],
                ["Mensualité estimée", monthly ? money(monthly, 2) : "—"],
                ["Taux au dépôt", terms.annualRate !== undefined ? `${terms.annualRate} %` : "—"],
                ["Coût total estimé", terms.simulation ? money(terms.simulation.totalCost, 2) : "—"],
              ].map(([k, v]) => (
                <div key={k} className="bg-night p-5"><p className="text-[13px] text-white/55">{k}</p><p className="tabular mt-1 font-display text-xl font-bold">{v}</p></div>
              ))}
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-3">
              <div><p className="text-[13px] text-white/55">Revenus déclarés</p><p className="tabular mt-1 font-semibold">{money(income)}</p></div>
              <div><p className="text-[13px] text-white/55">Taux d'effort estimé</p><p className={`tabular mt-1 font-display text-lg font-bold ${ratio !== null && ratio > 35 ? "text-[#F3A6A6]" : "text-teal"}`}>{ratio !== null ? `${ratio.toFixed(1)} %` : "—"}</p></div>
              <div><p className="text-[13px] text-white/55">Reste à vivre estimé</p><p className="tabular mt-1 font-semibold">{income ? money(remaining) : "—"}</p></div>
              <p className="flex gap-2 text-xs text-white/45 sm:col-span-3"><Info className="h-3.5 w-3.5 shrink-0" />Indicateurs calculés sur les données déclarées (charges + mensualité estimée) / revenus. Aide à l'analyse, non décisionnelle.</p>
            </div>
          </section>

          <Card title="Projet">
            <KeyValue rows={[["Objet", app.purpose], ["Offre", app.product.name], ["Durée", `${app.durationMonths} mois`], ["Frais / assurance au dépôt", `${terms.feesFixed ? money(terms.feesFixed) : "0"} + ${terms.feesPercent ?? 0} % · assurance ${terms.insuranceRate ?? 0} %/an`]]} />
            <div className="mt-5 border-t border-night/[.06] pt-5"><p className="text-[13px] text-ink-faint">Description</p><p className="mt-1 whitespace-pre-line">{app.description}</p></div>
          </Card>

          <Card title="Demandeur" action={user.can("customers.view") ? <Link href={`/admin/clients/${app.customerId}`} className="text-sm font-medium text-teal-700 hover:underline">Fiche client ({app.customer._count.applications} demande{app.customer._count.applications > 1 ? "s" : ""})</Link> : undefined}>
            <KeyValue cols={3} rows={[
              ["Nom", `${snap.firstName ?? ""} ${snap.lastName ?? ""}`],
              ["Date de naissance", snap.birthDate ? formatDate(String(snap.birthDate)) : "—"],
              ["Nationalité", String(snap.nationality ?? "—")],
              ["Email", app.customer.email],
              ["Téléphone", String(snap.phone ?? app.customer.phone)],
              ["Adresse", `${snap.address ?? ""}, ${snap.city ?? ""} — ${snap.country ?? ""}`],
              ["Profession", String(snap.profession ?? "—")],
              ["Situation", String(snap.employmentStatus ?? "—")],
              ["Employeur", String(snap.employer || "—")],
              ["Revenus mensuels", money(income)],
              ["Charges mensuelles", money(charges)],
              ["Consentements", `CG et données : ${formatDate(app.consentDataAt, "fr-FR", true)}`],
            ]} />
          </Card>

          <Card title={`Documents (${app.documents.length})`}>
            {pendingRequests.length > 0 && (
              <div className="mb-4 rounded-xl bg-[#FDF6E7] p-4">
                <p className="text-sm font-semibold text-[#7A4F0E]">Pièces attendues</p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {pendingRequests.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.label} <span className="text-ink-faint">· demandée le {formatDate(r.createdAt)}</span></span>{canUpdate && <CancelRequestButton id={r.id} />}</li>)}
                </ul>
              </div>
            )}
            {app.documents.length ? (
              <ul className="-my-4 divide-y divide-night/[.06]">
                {app.documents.map((d) => <DocumentRow key={d.id} doc={d} actions={<DocReview docId={d.id} status={d.status} canReview={user.can("documents.review")} />} />)}
              </ul>
            ) : <p className="text-sm text-ink-faint">Aucun document transmis.</p>}
          </Card>

          <Card title="Notes internes">
            <p className="mb-4 text-xs text-ink-faint">Jamais visibles par le client.</p>
            {canUpdate && <ReplyForm action={addInternalNote} hidden={{ id: app.id }} placeholder="Ajouter une note pour l'équipe…" label="Ajouter la note" />}
            <ul className="mt-6 space-y-4">
              {app.internalNotes.map((n) => (
                <li key={n.id} className="flex gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mist text-[11px] font-bold">{initials(n.author.firstName, n.author.lastName)}</span>
                  <div className="flex-1 rounded-xl bg-paper px-4 py-3">
                    <p className="text-xs text-ink-faint">{n.author.firstName} {n.author.lastName} · {formatDate(n.createdAt, "fr-FR", true)}</p>
                    <p className="mt-1 whitespace-pre-line text-[15px]">{n.body}</p>
                  </div>
                </li>
              ))}
              {app.internalNotes.length === 0 && <li className="text-sm text-ink-faint">Aucune note.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-6 print:hidden">
          {canUpdate && (
            <Card title="Traitement">
              <div className="mb-5">
                <p className="mb-1.5 text-sm font-medium">Agent en charge</p>
                <AssignSelect id={app.id} value={app.assignedToId} agents={agents} />
              </div>
              <StatusForm id={app.id} current={app.status} canDecide={user.can("applications.decide")} licensed={settings.compliance.licensed} />
            </Card>
          )}
          {app.decisionReason && <Card title="Justification de la décision"><p className="whitespace-pre-line text-sm">{app.decisionReason}</p><p className="mt-2 text-xs text-ink-faint">{formatDate(app.decidedAt, "fr-FR", true)}</p></Card>}
          {canUpdate && <Card title="Demander une pièce"><RequestDocForm id={app.id} /></Card>}
          <Card title="Historique">
            <ol className="space-y-4">
              {app.statusHistory.map((h) => (
                <li key={h.id} className="border-l-2 pl-4" style={{ borderColor: APPLICATION_STATUS_META[h.toStatus].color }}>
                  <p className="text-sm font-semibold">{h.fromStatus ? `${APPLICATION_STATUS_META[h.fromStatus].label} → ` : ""}{APPLICATION_STATUS_META[h.toStatus].label}</p>
                  <p className="text-xs text-ink-faint">{formatDate(h.createdAt, "fr-FR", true)} · {h.actor ? `${h.actor.firstName} ${h.actor.lastName}` : "Client"}</p>
                  {h.publicComment && <p className="mt-1 text-sm text-ink-soft">« {h.publicComment} »</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
