import { Mail } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { ActionButton } from "@/components/admin/small-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/surface";
import { setContactStatus } from "@/server/actions/admin/manage";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Messages de contact" };
const META = { NEW: { label: "Nouveau", tone: "info" }, IN_PROGRESS: { label: "En cours", tone: "amber" }, DONE: { label: "Traité", tone: "green" } } as const;

export default async function AdminMessages({ searchParams }: { searchParams: Promise<{ tous?: string }> }) {
  const sp = await searchParams;
  await requireStaff("messages.manage");
  const rows = await db.contactMessage.findMany({ where: sp.tous ? {} : { status: { not: "DONE" } }, include: { handledBy: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title="Messages de contact" text="Messages envoyés depuis le formulaire public." actions={<a href={sp.tous ? "/admin/messages" : "/admin/messages?tous=1"} className="text-sm font-medium text-teal-700 hover:underline">{sp.tous ? "Masquer les messages traités" : "Afficher aussi les messages traités"}</a>} />
      {rows.length === 0 ? <div className="rounded-2xl border border-night/[.07] bg-white"><EmptyState icon={<Mail className="h-5 w-5" />} title="Aucun message à traiter" /></div> : (
        <ul className="space-y-4">
          {rows.map((m) => (
            <li key={m.id} className="rounded-2xl border border-night/[.07] bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold">{m.subject}</p>
                  <p className="text-sm text-ink-faint">{m.name} · <a className="underline" href={`mailto:${m.email}?subject=${encodeURIComponent("Re: " + m.subject)}`}>{m.email}</a>{m.phone && ` · ${m.phone}`} · {formatDate(m.createdAt, "fr-FR", true)}</p>
                </div>
                <Badge tone={META[m.status].tone}>{META[m.status].label}</Badge>
              </div>
              <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">{m.message}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-night/[.06] pt-4">
                {m.status !== "IN_PROGRESS" && <ActionButton size="sm" variant="outline" run={setContactStatus.bind(null, m.id, "IN_PROGRESS")}>Prendre en charge</ActionButton>}
                {m.status !== "DONE" && <ActionButton size="sm" run={setContactStatus.bind(null, m.id, "DONE")}>Marquer comme traité</ActionButton>}
                {m.handledBy && <span className="text-xs text-ink-faint">Suivi par {m.handledBy.firstName} {m.handledBy.lastName}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
