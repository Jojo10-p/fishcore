import Link from "next/link";
import { Package } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/client/app-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/surface";
import { buttonVariants } from "@/components/ui/button";
import { ProductToggle } from "@/components/admin/product-controls";
import { CATEGORY_META } from "@/lib/status";
import { formatMoney, toNumber } from "@/lib/utils";

export const metadata = { title: "Offres" };

export default async function AdminProducts({ searchParams }: { searchParams: Promise<{ archives?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff("products.view");
  const s = await getSettings();
  const money = (n: unknown) => formatMoney(n, s.locale.currency, s.locale.numberLocale);
  const products = await db.loanProduct.findMany({ where: { archivedAt: sp.archives ? { not: null } : null }, include: { _count: { select: { applications: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const canManage = user.can("products.manage");
  return (
    <>
      <PageHeader
        title="Offres de financement"
        text="Les conditions saisies ici sont publiées sur le site et utilisées par le simulateur."
        actions={<>
          <Link href={sp.archives ? "/admin/offres" : "/admin/offres?archives=1"} className={buttonVariants({ variant: "ghost", size: "sm" })}>{sp.archives ? "Offres en cours" : "Archives"}</Link>
          {canManage && <Link href="/admin/offres/nouvelle" className={buttonVariants({ size: "sm" })}>Nouvelle offre</Link>}
        </>}
      />
      {products.length === 0 ? (
        <div className="rounded-2xl border border-night/[.07] bg-white"><EmptyState icon={<Package className="h-5 w-5" />} title={sp.archives ? "Aucune offre archivée" : "Aucune offre"} text="Créez votre première offre avec ses conditions réelles : montants, durées, taux, frais et pièces requises." action={canManage && !sp.archives ? <Link href="/admin/offres/nouvelle" className={buttonVariants()}>Créer une offre</Link> : undefined} /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => (
            <article key={p.id} className="flex flex-col rounded-2xl border border-night/[.07] bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] text-teal-700">{CATEGORY_META[p.category].fr}</p>
                {p.archivedAt ? <Badge tone="muted">Archivée</Badge> : p.isActive ? <Badge tone="green">Publiée</Badge> : <Badge tone="slate">Brouillon</Badge>}
              </div>
              <Link href={`/admin/offres/${p.id}`} className="mt-1 font-display text-lg font-bold hover:text-teal-700">{p.name}</Link>
              <dl className="tabular mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-ink-faint">Taux</dt><dd className="font-semibold">{toNumber(p.annualRate)} %</dd></div>
                <div><dt className="text-ink-faint">Demandes</dt><dd className="font-semibold">{p._count.applications}</dd></div>
                <div className="col-span-2"><dt className="text-ink-faint">Montants</dt><dd className="font-semibold">{money(p.minAmount)} – {money(p.maxAmount)}</dd></div>
              </dl>
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-night/[.06] pt-4 mt-5">
                <Link href={`/admin/offres/${p.id}`} className="text-sm font-medium text-teal-700 hover:underline">{canManage ? "Modifier" : "Consulter"}</Link>
                {canManage && !p.archivedAt && <ProductToggle id={p.id} active={p.isActive} />}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
