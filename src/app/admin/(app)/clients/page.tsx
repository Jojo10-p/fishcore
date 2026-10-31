import Link from "next/link";
import { Users } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Clients" };
const PER = 25;

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<{ q?: string; compte?: string; tri?: string; page?: string }> }) {
  const sp = await searchParams;
  await requireStaff("customers.view");
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.CustomerWhereInput = { deletedAt: null };
  if (sp.q) where.OR = ["lastName", "firstName", "email", "phone", "city"].map((f) => ({ [f]: { contains: sp.q, mode: "insensitive" } }));
  if (sp.compte === "SUSPENDED" || sp.compte === "ACTIVE") where.user = { status: sp.compte };
  if (sp.compte === "sans") where.userId = null;
  const orderBy: Prisma.CustomerOrderByWithRelationInput = sp.tri === "nom" ? { lastName: "asc" } : sp.tri === "ancien" ? { createdAt: "asc" } : { createdAt: "desc" };
  const [total, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({ where, orderBy, skip: (page - 1) * PER, take: PER, include: { user: true, _count: { select: { applications: true, documents: true } } } }),
  ]);
  const href = (p: number) => `/admin/clients?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), page: String(p) } as Record<string, string>)}`;
  return (
    <>
      <PageHeader title="Clients" text={`${total} client${total > 1 ? "s" : ""}`} />
      <FilterBar placeholder="Nom, email, téléphone, ville…" filters={[
        { name: "compte", label: "Tous les comptes", type: "select", options: [{ value: "ACTIVE", label: "Actifs" }, { value: "SUSPENDED", label: "Suspendus" }, { value: "sans", label: "Sans compte" }] },
        { name: "tri", label: "Plus récents", type: "select", options: [{ value: "ancien", label: "Plus anciens" }, { value: "nom", label: "Nom (A→Z)" }] },
      ]} />
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {rows.length === 0 ? <EmptyState icon={<Users className="h-5 w-5" />} title="Aucun client" text="Aucun client ne correspond à ces critères." /> : (
          <ul className="divide-y divide-night/[.06]">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/clients/${c.id}`} className="grid gap-2 px-5 py-4 hover:bg-paper/60 sm:grid-cols-[1.5fr_1fr_auto_auto] sm:items-center sm:gap-6">
                  <div className="min-w-0"><p className="font-semibold">{c.lastName.toUpperCase()} {c.firstName}{c.isDemo && <span className="ml-2 text-xs font-normal text-champagne-700">démo</span>}</p><p className="truncate text-sm text-ink-faint">{c.email} · {c.phone}</p></div>
                  <p className="text-sm text-ink-soft">{[c.city, c.country].filter(Boolean).join(", ") || "—"}<span className="block text-xs text-ink-faint">Inscrit le {formatDate(c.createdAt)}</span></p>
                  <p className="tabular text-sm text-ink-soft">{c._count.applications} demande{c._count.applications > 1 ? "s" : ""} · {c._count.documents} doc.</p>
                  <div>{!c.user ? <Badge tone="muted">Sans compte</Badge> : c.user.status === "ACTIVE" ? <Badge tone="green">Actif</Badge> : <Badge tone="red">Suspendu</Badge>}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Pagination page={page} pageCount={Math.ceil(total / PER)} total={total} buildHref={href} />
    </>
  );
}
