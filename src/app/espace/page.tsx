import Link from "next/link";
import { FilePlus2, Upload, MessageCircle, Calculator, ArrowUpRight } from "lucide-react";
import { db } from "@/lib/db";
import { requireCustomer } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/client/app-shell";
import { Card, StatusBadge, Timeline, LinkMore } from "@/components/client/shared";
import { EmptyState } from "@/components/ui/surface";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/utils";

export default async function ClientDashboard() {
  const user = await requireCustomer();
  const settings = await getSettings();
  const money = (n: unknown) => formatMoney(n, settings.locale.currency, settings.locale.numberLocale);
  const [apps, notifications, requests, docCount] = await Promise.all([
    db.loanApplication.findMany({ where: { customerId: user.customer.id, deletedAt: null }, include: { product: true, statusHistory: { orderBy: { createdAt: "desc" }, take: 4 } }, orderBy: { createdAt: "desc" } }),
    db.notification.findMany({ where: { userId: user.id, channel: "IN_APP" }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.documentRequest.findMany({ where: { fulfilledAt: null, application: { customerId: user.customer.id, deletedAt: null, status: { notIn: ["CLOSED", "REJECTED"] } } }, include: { application: true } }),
    db.applicationDocument.count({ where: { customerId: user.customer.id, deletedAt: null } }),
  ]);
  const last = apps[0];
  const open = apps.filter((a) => !["CLOSED", "REJECTED", "APPROVED"].includes(a.status)).length;
  const quick = [
    { href: "/demande", label: "Nouvelle demande", icon: FilePlus2 },
    { href: "/espace/documents", label: "Transmettre un document", icon: Upload },
    { href: "/espace/assistance/nouveau", label: "Contacter un conseiller", icon: MessageCircle },
    { href: "/simulateur", label: "Faire une simulation", icon: Calculator },
  ];

  return (
    <>
      <PageHeader title={`Bonjour ${user.firstName}`} text="Voici l'état de vos demandes de financement." />

      {requests.length > 0 && (
        <div className="mb-6 rounded-2xl border border-[#F1D9A8] bg-[#FDF6E7] p-5">
          <p className="font-display font-bold text-[#7A4F0E]">{requests.length} pièce{requests.length > 1 ? "s" : ""} à transmettre</p>
          <ul className="mt-2 space-y-1 text-sm text-[#7A4F0E]">
            {requests.slice(0, 4).map((r) => <li key={r.id}>{r.label} — dossier <Link className="font-semibold underline" href={`/espace/demandes/${r.applicationId}`}>{r.application.reference}</Link></li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Demandes déposées", apps.length],
          ["Demandes en cours", open],
          ["Documents transmis", docCount],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-2xl border border-night/[.07] bg-white p-5">
            <p className="text-sm text-ink-faint">{k}</p>
            <p className="tabular mt-1 font-display text-3xl font-extrabold">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {last ? (
            <section className="overflow-hidden rounded-2xl bg-night text-white">
              <div className="flex flex-wrap items-start justify-between gap-4 p-6 sm:p-7">
                <div>
                  <p className="text-sm text-white/55">Dernière demande · {last.reference}</p>
                  <p className="mt-1 font-display text-2xl font-bold">{last.product.name}</p>
                  <p className="tabular mt-1 text-white/70">{money(last.amount)} sur {last.durationMonths} mois · déposée le {formatDate(last.createdAt)}</p>
                </div>
                <StatusBadge status={last.status} licensed={settings.compliance.licensed} />
              </div>
              <div className="bg-white p-6 text-ink sm:p-7">
                <Timeline items={last.statusHistory} licensed={settings.compliance.licensed} />
                <Link href={`/espace/demandes/${last.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-6" })}>Voir le dossier <ArrowUpRight className="h-4 w-4" /></Link>
              </div>
            </section>
          ) : (
            <Card><EmptyState icon={<FilePlus2 className="h-5 w-5" />} title="Aucune demande pour le moment" text="Simulez votre financement puis déposez votre dossier en ligne." action={<Link href="/demande" className={buttonVariants()}>Demander un financement</Link>} /></Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Actions rapides">
            <ul className="-my-1 space-y-1">
              {quick.map((q) => (
                <li key={q.href}><Link href={q.href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-[15px] hover:bg-paper"><q.icon className="h-[18px] w-[18px] text-teal" strokeWidth={1.8} />{q.label}</Link></li>
              ))}
            </ul>
          </Card>
          <Card title="Notifications" action={<LinkMore href="/espace/notifications">Tout voir</LinkMore>}>
            {notifications.length ? (
              <ul className="-my-2 divide-y divide-night/[.06]">
                {notifications.map((n) => (
                  <li key={n.id} className="py-3">
                    <Link href={n.link ?? "/espace/notifications"} className="block">
                      <p className={`text-sm ${n.readAt ? "" : "font-semibold"}`}>{!n.readAt && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-teal" />}{n.title}</p>
                      <p className="mt-0.5 text-xs text-ink-faint">{formatDate(n.createdAt, "fr-FR", true)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-faint">Aucune notification.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
