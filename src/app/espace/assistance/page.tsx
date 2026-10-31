import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { db } from "@/lib/db";
import { requireCustomer } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/surface";
import { buttonVariants } from "@/components/ui/button";
import { TICKET_STATUS_META } from "@/lib/status";
import { formatDate } from "@/lib/utils";

export default async function SupportList() {
  const user = await requireCustomer();
  const tickets = await db.supportTicket.findMany({ where: { customerId: user.customer.id }, include: { application: true, _count: { select: { messages: true } } }, orderBy: { updatedAt: "desc" } });
  return (
    <>
      <PageHeader title="Assistance" text="Échangez avec nos conseillers au sujet de vos demandes." actions={<Link href="/espace/assistance/nouveau" className={buttonVariants({ size: "sm" })}>Nouvelle demande d'assistance</Link>} />
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {tickets.length === 0 ? (
          <EmptyState icon={<LifeBuoy className="h-5 w-5" />} title="Aucune conversation" text="Une question sur votre dossier ? Écrivez-nous, un conseiller vous répondra ici." action={<Link href="/espace/assistance/nouveau" className={buttonVariants()}>Contacter un conseiller</Link>} />
        ) : (
          <ul className="divide-y divide-night/[.06]">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/espace/assistance/${t.id}`} className="flex flex-col gap-2 px-5 py-4 hover:bg-paper/60 sm:flex-row sm:items-center sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t.subject}</p>
                    <p className="text-sm text-ink-faint">{t.reference}{t.application && ` · dossier ${t.application.reference}`} · {t._count.messages} message{t._count.messages > 1 ? "s" : ""} · {formatDate(t.updatedAt, "fr-FR", true)}</p>
                  </div>
                  <Badge tone={TICKET_STATUS_META[t.status].tone}>{TICKET_STATUS_META[t.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
