import Link from "next/link";
import { FolderOpen, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { requireCustomer } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/client/app-shell";
import { StatusBadge } from "@/components/client/shared";
import { EmptyState } from "@/components/ui/surface";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/utils";

export default async function MyApplications() {
  const user = await requireCustomer();
  const s = await getSettings();
  const apps = await db.loanApplication.findMany({ where: { customerId: user.customer.id, deletedAt: null }, include: { product: true }, orderBy: { createdAt: "desc" } });
  const money = (n: unknown) => formatMoney(n, s.locale.currency, s.locale.numberLocale);
  return (
    <>
      <PageHeader title="Mes demandes" text="Historique et suivi de vos demandes de financement." actions={<Link href="/demande" className={buttonVariants({ size: "sm" })}>Nouvelle demande</Link>} />
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {apps.length === 0 ? (
          <EmptyState icon={<FolderOpen className="h-5 w-5" />} title="Aucune demande" text="Vos demandes apparaîtront ici dès leur dépôt." action={<Link href="/demande" className={buttonVariants()}>Déposer une demande</Link>} />
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-night/[.06] text-[13px] text-ink-faint">
                <tr><th className="px-6 py-3 font-medium">Dossier</th><th className="px-4 py-3 font-medium">Financement</th><th className="px-4 py-3 text-right font-medium">Montant</th><th className="px-4 py-3 font-medium">Dépôt</th><th className="px-4 py-3 font-medium">Statut</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-night/[.06]">
                {apps.map((a) => (
                  <tr key={a.id} className="hover:bg-paper/60">
                    <td className="px-6 py-4 font-semibold tabular"><Link href={`/espace/demandes/${a.id}`} className="hover:text-teal-700">{a.reference}</Link></td>
                    <td className="px-4 py-4">{a.product.name}</td>
                    <td className="tabular px-4 py-4 text-right">{money(a.amount)}</td>
                    <td className="px-4 py-4 text-ink-soft">{formatDate(a.createdAt)}</td>
                    <td className="px-4 py-4"><StatusBadge status={a.status} licensed={s.compliance.licensed} /></td>
                    <td className="px-4 py-4 text-right"><Link href={`/espace/demandes/${a.id}`} className="text-sm font-medium text-teal-700 hover:underline">Consulter</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-night/[.06] md:hidden">
              {apps.map((a) => (
                <li key={a.id}>
                  <Link href={`/espace/demandes/${a.id}`} className="flex items-center gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold tabular">{a.reference}</p>
                      <p className="truncate text-sm text-ink-soft">{a.product.name} · {money(a.amount)}</p>
                      <div className="mt-2"><StatusBadge status={a.status} licensed={s.compliance.licensed} /></div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
