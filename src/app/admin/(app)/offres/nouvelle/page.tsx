import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/client/app-shell";
import { ProductForm } from "@/components/admin/product-form";

export const metadata = { title: "Nouvelle offre" };

export default async function NewProduct() {
  await requireStaff("products.manage");
  const s = await getSettings();
  return (
    <>
      <Link href="/admin/offres" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ChevronLeft className="h-4 w-4" />Offres</Link>
      <PageHeader title="Nouvelle offre" text="L'offre reste en brouillon tant que vous ne la publiez pas." />
      <ProductForm currency={s.locale.currency} initial={{ name: "", slug: "", category: "PERSONAL", tagline: "", description: "", minAmount: "", maxAmount: "", minDurationMonths: "", maxDurationMonths: "", annualRate: "", feesFixed: "0", feesPercent: "0", insuranceRate: "0", eligibility: "", requiredDocuments: [{ key: "identity", label: "Pièce d'identité", required: true }, { key: "income", label: "Justificatif de revenus", required: true }, { key: "address", label: "Justificatif de domicile", required: true }], isActive: false, sortOrder: "0" }} />
    </>
  );
}
