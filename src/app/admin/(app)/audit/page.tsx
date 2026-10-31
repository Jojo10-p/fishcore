import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Journal d'audit" };
const PER = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; entite?: string; page?: string }> }) {
  const sp = await searchParams;
  await requireStaff("audit.view");
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {};
  if (sp.q) where.OR = [{ action: { contains: sp.q, mode: "insensitive" } }, { entityId: { contains: sp.q } }, { actor: { email: { contains: sp.q, mode: "insensitive" } } }, { ip: { contains: sp.q } }];
  if (sp.entite) where.entity = sp.entite;
  const [total, logs, entities] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, include: { actor: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true } }),
  ]);
  return (
    <>
      <PageHeader title="Journal d'audit" text="Traçabilité des actions sensibles : connexions, décisions, consultations de documents, modifications de paramètres." />
      <FilterBar placeholder="Action, email, IP, identifiant…" filters={[{ name: "entite", label: "Toutes les entités", type: "select", options: entities.map((e) => ({ value: e.entity, label: e.entity })) }]} />
      <div className="overflow-x-auto rounded-2xl border border-night/[.07] bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-night/[.06] bg-paper/60 text-[13px] text-ink-faint"><tr><th className="px-5 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Acteur</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Cible</th><th className="px-4 py-3 font-medium">IP</th></tr></thead>
          <tbody className="divide-y divide-night/[.06]">
            {logs.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="tabular whitespace-nowrap px-5 py-3 text-ink-soft">{formatDate(l.createdAt, "fr-FR", true)}</td>
                <td className="px-4 py-3">{l.actor ? <>{l.actor.firstName} {l.actor.lastName}<span className="block text-xs text-ink-faint">{l.actor.email}</span></> : <span className="text-ink-faint">système</span>}</td>
                <td className="px-4 py-3 font-medium">{l.action}{l.metadata ? <code className="mt-1 block max-w-md truncate text-xs font-normal text-ink-faint">{JSON.stringify(l.metadata)}</code> : null}</td>
                <td className="px-4 py-3 text-ink-soft">{l.entity}<span className="block font-mono text-xs text-ink-faint">{l.entityId?.slice(0, 13)}</span></td>
                <td className="tabular px-4 py-3 text-ink-faint">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={Math.ceil(total / PER)} total={total} buildHref={(p) => `/admin/audit?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.entite ? { entite: sp.entite } : {}), page: String(p) })}`} />
    </>
  );
}
