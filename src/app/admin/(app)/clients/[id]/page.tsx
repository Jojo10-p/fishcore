import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { Card, StatusBadge, DocumentRow, KeyValue } from "@/components/client/shared";
import { ActionButton } from "@/components/admin/small-actions";
import { Badge } from "@/components/ui/badge";
import { setCustomerAccountStatus } from "@/server/actions/admin/manage";
import { formatDate, formatMoney } from "@/lib/utils";
import { TICKET_STATUS_META } from "@/lib/status";

export const metadata = { title: "Client" };

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireStaff("customers.view");
  const s = await getSettings();
  const c = await db.customer.findFirst({
    where: { id, deletedAt: null },
    include: {
      user: { include: { sessions: { orderBy: { createdAt: "desc" }, take: 5 } } },
      applications: { where: { deletedAt: null }, include: { product: true }, orderBy: { createdAt: "desc" } },
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      tickets: { orderBy: { updatedAt: "desc" } },
    },
  });
  if (!c) notFound();
  const activity = c.userId ? await db.auditLog.findMany({ where: { actorId: c.userId }, orderBy: { createdAt: "desc" }, take: 15 }) : [];
  const money = (n: unknown) => formatMoney(n, s.locale.currency, s.locale.numberLocale);
  const u = c.user;
  return (
    <>
      <Link href="/admin/clients" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ChevronLeft className="h-4 w-4" />Clients</Link>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[1.9rem] font-extrabold">{c.firstName} {c.lastName}</h1>
          <p className="mt-1 text-ink-soft">{c.email} · client depuis le {formatDate(c.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          {!u ? <Badge tone="muted">Sans compte</Badge> : u.status === "ACTIVE" ? <Badge tone="green">Compte actif</Badge> : <Badge tone="red">Compte suspendu</Badge>}
          {u && user.can("customers.manage") && (u.status === "ACTIVE" ? (
            <ActionButton variant="outline" size="sm" run={() => setCustomerAccountStatus(u.id, "SUSPENDED")} confirm={{ title: "Suspendre ce compte ?", description: "Le client ne pourra plus se connecter et ses sessions seront fermées. Ses dossiers sont conservés.", label: "Suspendre", danger: true }}>Suspendre</ActionButton>
          ) : (
            <ActionButton variant="outline" size="sm" run={() => setCustomerAccountStatus(u.id, "ACTIVE")}>Réactiver</ActionButton>
          ))}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Profil">
            <KeyValue cols={3} rows={[
              ["Téléphone", c.phone], ["Date de naissance", formatDate(c.birthDate)], ["Nationalité", c.nationality ?? "—"],
              ["Adresse", c.address], ["Ville", c.city], ["Pays", c.country],
              ["Profession", c.profession ?? "—"], ["Situation", c.employmentStatus ?? "—"], ["Employeur", c.employer ?? "—"],
              ["Revenus mensuels", c.monthlyIncome ? money(c.monthlyIncome) : "—"], ["Charges mensuelles", c.monthlyCharges ? money(c.monthlyCharges) : "—"], ["Dernière connexion", formatDate(u?.lastLoginAt, "fr-FR", true)],
            ]} />
          </Card>
          <Card title={`Demandes (${c.applications.length})`}>
            {c.applications.length === 0 ? <p className="text-sm text-ink-faint">Aucune demande.</p> : (
              <ul className="-my-3 divide-y divide-night/[.06]">
                {c.applications.map((a) => (
                  <li key={a.id}><Link href={`/admin/demandes/${a.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:opacity-80"><span className="tabular font-semibold">{a.reference}</span><span className="flex-1 text-sm text-ink-soft">{a.product.name} · {formatDate(a.createdAt)}</span><span className="tabular font-semibold">{money(a.amount)}</span><StatusBadge status={a.status} licensed={s.compliance.licensed} /></Link></li>
                ))}
              </ul>
            )}
          </Card>
          {user.can("documents.view") && (
            <Card title={`Documents (${c.documents.length})`}>
              {c.documents.length ? <ul className="-my-4 divide-y divide-night/[.06]">{c.documents.map((d) => <DocumentRow key={d.id} doc={d} />)}</ul> : <p className="text-sm text-ink-faint">Aucun document.</p>}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Assistance">
            {c.tickets.length === 0 ? <p className="text-sm text-ink-faint">Aucune conversation.</p> : (
              <ul className="space-y-3 text-sm">{c.tickets.map((t) => <li key={t.id} className="flex items-center justify-between gap-2"><Link className="truncate hover:underline" href={`/admin/assistance/${t.id}`}>{t.subject}</Link><Badge tone={TICKET_STATUS_META[t.status].tone}>{TICKET_STATUS_META[t.status].label}</Badge></li>)}</ul>
            )}
          </Card>
          <Card title="Activité du compte">
            {activity.length === 0 ? <p className="text-sm text-ink-faint">Aucune activité enregistrée.</p> : (
              <ul className="space-y-2.5 text-sm">{activity.map((l) => <li key={l.id}><p>{l.action}</p><p className="text-xs text-ink-faint">{formatDate(l.createdAt, "fr-FR", true)} · {l.ip}</p></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
