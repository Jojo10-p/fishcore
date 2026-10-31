import Link from "next/link";
import { Download, FolderOpen } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { buildApplicationOrder, buildApplicationWhere, type AppFilters } from "@/server/services/admin-applications";
import { PageHeader } from "@/components/client/app-shell";
import { StatusBadge } from "@/components/client/shared";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/surface";
import { buttonVariants } from "@/components/ui/button";
import { APPLICATION_STATUSES, APPLICATION_STATUS_META } from "@/lib/status";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Demandes" };
const PER_PAGE = 20;

export default async function AdminApplications({ searchParams }: { searchParams: Promise<AppFilters> }) {
  const sp = await searchParams;
  const user = await requireStaff("applications.view");
  const settings = await getSettings();
  const money = (n: unknown) => formatMoney(n, settings.locale.currency, settings.locale.numberLocale);
  const page = Math.max(1, Number(sp.page) || 1);
  const where = buildApplicationWhere(sp);
  const [total, rows, products] = await Promise.all([
    db.loanApplication.count({ where }),
    db.loanApplication.findMany({ where, include: { customer: true, product: true, assignedTo: true, _count: { select: { documentRequests: { where: { fulfilledAt: null } } } } }, orderBy: buildApplicationOrder(sp.tri), skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    db.loanProduct.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    u.set("page", String(p));
    return `/admin/demandes?${u}`;
  };
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Demandes de financement"
        text={`${total} dossier${total > 1 ? "s" : ""}`}
        actions={user.can("applications.export") ? <a href={`/api/admin/applications/export?${exportQs}`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" />Exporter (CSV)</a> : undefined}
      />
      <FilterBar
        placeholder="Nom, email ou référence…"
        filters={[
          { name: "statut", label: "Tous les statuts", type: "select", options: APPLICATION_STATUSES.map((s) => ({ value: s, label: APPLICATION_STATUS_META[s].label })) },
          { name: "produit", label: "Toutes les offres", type: "select", options: products.map((p) => ({ value: p.id, label: p.name })) },
          { name: "tri", label: "Plus récentes", type: "select", options: [{ value: "ancien", label: "Plus anciennes" }, { value: "montant-desc", label: "Montant décroissant" }, { value: "montant-asc", label: "Montant croissant" }, { value: "nom", label: "Nom (A→Z)" }] },
          { name: "du", label: "Du", type: "date" },
          { name: "au", label: "Au", type: "date" },
        ]}
      />
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {rows.length === 0 ? (
          <EmptyState icon={<FolderOpen className="h-5 w-5" />} title="Aucune demande" text="Aucun dossier ne correspond à ces critères." />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-night/[.06] bg-paper/60 text-[13px] text-ink-faint">
                  <tr><th className="px-5 py-3 font-medium">Référence</th><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Offre</th><th className="px-4 py-3 text-right font-medium">Montant</th><th className="px-4 py-3 font-medium">Durée</th><th className="px-4 py-3 font-medium">Dépôt</th><th className="px-4 py-3 font-medium">Statut</th><th className="px-4 py-3 font-medium">Agent</th></tr>
                </thead>
                <tbody className="divide-y divide-night/[.06]">
                  {rows.map((a) => (
                    <tr key={a.id} className="group hover:bg-paper/70">
                      <td className="px-5 py-3.5"><Link href={`/admin/demandes/${a.id}`} className="tabular font-semibold group-hover:text-teal-700">{a.reference}</Link>{a.isDemo && <span className="ml-2 text-xs text-champagne-700">démo</span>}</td>
                      <td className="px-4 py-3.5"><p className="font-medium">{a.customer.firstName} {a.customer.lastName}</p><p className="text-xs text-ink-faint">{a.customer.email}</p></td>
                      <td className="px-4 py-3.5 text-ink-soft">{a.product.name}</td>
                      <td className="tabular px-4 py-3.5 text-right font-semibold">{money(a.amount)}</td>
                      <td className="tabular px-4 py-3.5 text-ink-soft">{a.durationMonths} m</td>
                      <td className="px-4 py-3.5 text-ink-soft">{formatDate(a.createdAt)}</td>
                      <td className="px-4 py-3.5"><StatusBadge status={a.status} licensed={settings.compliance.licensed} />{a._count.documentRequests > 0 && <p className="mt-1 text-xs text-[#9A6412]">{a._count.documentRequests} pièce(s) attendue(s)</p>}</td>
                      <td className="px-4 py-3.5 text-ink-soft">{a.assignedTo ? `${a.assignedTo.firstName} ${a.assignedTo.lastName.charAt(0)}.` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-night/[.06] lg:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/demandes/${a.id}`} className="block px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-semibold">{a.customer.firstName} {a.customer.lastName}</p><p className="tabular text-xs text-ink-faint">{a.reference} · {formatDate(a.createdAt)}</p></div>
                      <span className="tabular font-semibold">{money(a.amount)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-sm text-ink-soft">{a.product.name}</span><StatusBadge status={a.status} licensed={settings.compliance.licensed} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Pagination page={page} pageCount={Math.ceil(total / PER_PAGE)} total={total} buildHref={qs} />
    </>
  );
}
