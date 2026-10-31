import Link from "next/link";
import { db, tbl } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/client/app-shell";
import { Card, StatusBadge, LinkMore } from "@/components/client/shared";
import { TrendChart, HBarChart } from "@/components/admin/charts";
import { Badge } from "@/components/ui/badge";
import { APPLICATION_STATUS_META, APPLICATION_STATUSES } from "@/lib/status";
import { formatDate, formatMoney, toNumber } from "@/lib/utils";

export const metadata = { title: "Tableau de bord" };

const ACTION_LABELS: Record<string, string> = {
  "application.submitted": "Demande déposée",
  "application.status_changed": "Statut modifié",
  "application.note_added": "Note interne ajoutée",
  "application.document_requested": "Pièce demandée",
  "document.uploaded": "Document transmis",
  "document.accepted": "Document validé",
  "document.rejected": "Document refusé",
  "product.created": "Offre créée",
  "product.updated": "Offre modifiée",
  "auth.login": "Connexion",
  "settings.updated": "Paramètres modifiés",
};

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff();
  const settings = await getSettings();
  const money = (n: unknown) => formatMoney(n, settings.locale.currency, settings.locale.numberLocale);
  if (!user.can("dashboard.view")) return <PageHeader title={`Bonjour ${user.firstName}`} text="Votre rôle ne donne pas accès au tableau de bord." />;

  const where = { deletedAt: null };
  const since = new Date();
  since.setDate(since.getDate() - 7 * 11);
  since.setHours(0, 0, 0, 0);
  const [customers, byStatus, sumAll, sumApproved, byProductRaw, products, recent, activity, weekly, demoCount] = await Promise.all([
    db.customer.count({ where: { deletedAt: null } }),
    db.loanApplication.groupBy({ by: ["status"], where, _count: true }),
    db.loanApplication.aggregate({ where, _sum: { amount: true }, _count: true }),
    db.loanApplication.aggregate({ where: { ...where, status: "APPROVED" }, _sum: { amount: true } }),
    db.loanApplication.groupBy({ by: ["productId"], where, _count: true }),
    db.loanProduct.findMany({ select: { id: true, name: true } }),
    db.loanApplication.findMany({ where, include: { customer: true, product: true }, orderBy: { createdAt: "desc" }, take: 6 }),
    user.can("audit.view") ? db.auditLog.findMany({ where: { action: { notIn: ["auth.login", "auth.logout", "auth.failed", "document.viewed"] } }, include: { actor: true }, orderBy: { createdAt: "desc" }, take: 8 }) : Promise.resolve([]),
    db.$queryRaw<{ week: Date; count: number }[]>`SELECT date_trunc('week', "createdAt") AS week, COUNT(*)::int AS count FROM ${tbl("loan_applications")} WHERE "deletedAt" IS NULL AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    db.loanApplication.count({ where: { isDemo: true } }),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(since);
    d.setDate(d.getDate() + i * 7);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const hit = weekly.find((w) => new Date(w.week).toDateString() === monday.toDateString());
    return { label: monday.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }), count: hit?.count ?? 0 };
  });
  const palette = ["#101C35", "#20B6A5", "#C9A96E", "#263B58", "#8592A8", "#1A9A8C"];
  const byProduct = byProductRaw.map((b, i) => ({ label: products.find((p) => p.id === b.productId)?.name ?? "—", value: b._count, color: palette[i % palette.length] })).sort((a, b) => b.value - a.value);
  const byStatusData = APPLICATION_STATUSES.map((s) => ({ label: s === "APPROVED" && !settings.compliance.licensed ? "Avis favorable" : APPLICATION_STATUS_META[s].label, value: count(s), color: APPLICATION_STATUS_META[s].color }));

  const kpis: [string, string | number, string?][] = [
    ["Clients", customers],
    ["Demandes", sumAll._count],
    ["Nouvelles", count("NEW"), "/admin/demandes?statut=NEW"],
    ["En analyse", count("UNDER_REVIEW"), "/admin/demandes?statut=UNDER_REVIEW"],
    [settings.compliance.licensed ? "Approuvées" : "Avis favorables", count("APPROVED"), "/admin/demandes?statut=APPROVED"],
    ["Refusées", count("REJECTED"), "/admin/demandes?statut=REJECTED"],
  ];

  return (
    <>
      {sp.denied && <div className="mb-6 rounded-xl bg-[#FCEBEB] px-4 py-3 text-sm text-[#9E2B2B]">Vous n'avez pas accès à cette section.</div>}
      <PageHeader title={`Bonjour ${user.firstName}`} text={`Activité au ${formatDate(new Date())}`} actions={demoCount > 0 ? <Badge tone="champagne">{demoCount} demandes de démonstration incluses</Badge> : undefined} />

      <section className="grid overflow-hidden rounded-2xl bg-night text-white lg:grid-cols-[1.3fr_1fr]">
        <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-3">
          {kpis.map(([k, v, href]) => {
            const inner = (<><p className="text-[13px] text-white/55">{k}</p><p className="tabular mt-1 font-display text-3xl font-extrabold">{v}</p></>);
            return href ? <Link key={k} href={href} className="bg-night p-5 transition hover:bg-night-700">{inner}</Link> : <div key={k} className="bg-night p-5">{inner}</div>;
          })}
        </div>
        <div className="flex flex-col justify-center gap-5 border-t border-white/10 p-6 lg:border-l lg:border-t-0">
          <div><p className="text-[13px] text-white/55">Montant total demandé</p><p className="tabular mt-1 font-display text-3xl font-extrabold">{money(sumAll._sum.amount)}</p></div>
          <div className="rule-champagne" />
          <div><p className="text-[13px] text-white/55">{settings.compliance.licensed ? "Montant total approuvé" : "Montant des avis favorables"}</p><p className="tabular mt-1 font-display text-3xl font-extrabold text-champagne">{money(toNumber(sumApproved._sum.amount))}</p></div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Évolution des demandes (12 semaines)" className="xl:col-span-2"><TrendChart data={weeks} /></Card>
        <Card title="Répartition par statut"><HBarChart data={byStatusData} /></Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Dernières demandes reçues" className="xl:col-span-2" action={<LinkMore href="/admin/demandes">Toutes les demandes</LinkMore>}>
          {recent.length === 0 ? <p className="text-sm text-ink-faint">Aucune demande pour le moment.</p> : (
            <ul className="-my-3 divide-y divide-night/[.06]">
              {recent.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/demandes/${a.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:opacity-80">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{a.customer.firstName} {a.customer.lastName}{a.isDemo && <span className="ml-2 text-xs font-normal text-champagne-700">démo</span>}</p>
                      <p className="tabular text-sm text-ink-faint">{a.reference} · {a.product.name} · {formatDate(a.createdAt)}</p>
                    </div>
                    <span className="tabular font-semibold">{money(a.amount)}</span>
                    <StatusBadge status={a.status} licensed={settings.compliance.licensed} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Par type de financement">{byProduct.length ? <HBarChart data={byProduct} /> : <p className="text-sm text-ink-faint">Pas encore de données.</p>}</Card>
          {user.can("audit.view") && (
            <Card title="Activités récentes" action={<LinkMore href="/admin/audit">Journal</LinkMore>}>
              {activity.length === 0 ? <p className="text-sm text-ink-faint">Aucune activité.</p> : (
                <ul className="space-y-3 text-sm">
                  {activity.map((l) => (
                    <li key={l.id} className="flex gap-3">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                      <div><p>{ACTION_LABELS[l.action] ?? l.action}<span className="text-ink-faint"> — {l.actor ? `${l.actor.firstName} ${l.actor.lastName}` : "système"}</span></p><p className="text-xs text-ink-faint">{formatDate(l.createdAt, "fr-FR", true)}</p></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
