import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/client/app-shell";
import { ProductForm } from "@/components/admin/product-form";
import { ArchiveProduct, RestoreProduct } from "@/components/admin/product-controls";
import { FormStatus } from "@/components/ui/form-status";
import { toNumber } from "@/lib/utils";

export const metadata = { title: "Offre" };

export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireStaff("products.view");
  const s = await getSettings();
  const p = await db.loanProduct.findUnique({ where: { id }, include: { _count: { select: { applications: true } } } });
  if (!p) notFound();
  const canManage = user.can("products.manage");
  return (
    <>
      <Link href="/admin/offres" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ChevronLeft className="h-4 w-4" />Offres</Link>
      <PageHeader title={p.name} text={`${p._count.applications} demande(s) liée(s). Les dossiers déposés conservent les conditions en vigueur au moment du dépôt.`} actions={canManage ? (p.archivedAt ? <RestoreProduct id={p.id} /> : <ArchiveProduct id={p.id} hasApplications={p._count.applications > 0} />) : undefined} />
      {sp.created && <div className="mb-6"><FormStatus state={{ ok: true, message: "Offre créée. Publiez-la lorsque ses conditions sont validées." }} /></div>}
      <ProductForm
        readOnly={!canManage}
        currency={s.locale.currency}
        initial={{
          id: p.id, name: p.name, slug: p.slug, category: p.category, tagline: p.tagline ?? "", description: p.description,
          minAmount: String(toNumber(p.minAmount)), maxAmount: String(toNumber(p.maxAmount)), minDurationMonths: String(p.minDurationMonths), maxDurationMonths: String(p.maxDurationMonths),
          annualRate: String(toNumber(p.annualRate)), feesFixed: String(toNumber(p.feesFixed)), feesPercent: String(toNumber(p.feesPercent)), insuranceRate: String(toNumber(p.insuranceRate)),
          eligibility: p.eligibility.join("\n"), requiredDocuments: (p.requiredDocuments as { key: string; label: string; required: boolean }[]) ?? [], isActive: p.isActive, sortOrder: String(p.sortOrder),
        }}
      />
    </>
  );
}
