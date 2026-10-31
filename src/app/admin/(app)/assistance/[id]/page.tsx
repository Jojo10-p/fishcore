import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { Card } from "@/components/client/shared";
import { TicketThread } from "@/components/client/ticket-thread";
import { ReplyForm } from "@/components/client/reply-form";
import { ActionButton } from "@/components/admin/small-actions";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/field";
import { staffReplyTicket, setTicketStatus } from "@/server/actions/admin/manage";
import { TICKET_STATUS_META } from "@/lib/status";

export const metadata = { title: "Conversation" };

export default async function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await requireStaff("messages.manage");
  const t = await db.supportTicket.findUnique({ where: { id }, include: { customer: true, application: true, messages: { include: { author: true }, orderBy: { createdAt: "asc" } } } });
  if (!t) notFound();
  return (
    <>
      <Link href="/admin/assistance" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ChevronLeft className="h-4 w-4" />Assistance</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-faint">{t.reference} · <Link className="underline" href={`/admin/clients/${t.customerId}`}>{t.customer.firstName} {t.customer.lastName}</Link>{t.application && <> · <Link className="underline" href={`/admin/demandes/${t.application.id}`}>{t.application.reference}</Link></>}</p>
          <h1 className="mt-1 text-[1.7rem] font-extrabold">{t.subject}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={TICKET_STATUS_META[t.status].tone}>{TICKET_STATUS_META[t.status].label}</Badge>
          {t.status === "CLOSED" ? <ActionButton size="sm" variant="outline" run={setTicketStatus.bind(null, t.id, "OPEN")}>Rouvrir</ActionButton> : <ActionButton size="sm" variant="outline" run={setTicketStatus.bind(null, t.id, "CLOSED")}>Fermer</ActionButton>}
        </div>
      </div>
      <Card className="max-w-3xl">
        <TicketThread messages={t.messages} viewer="staff" />
        <div className="mt-8 border-t border-night/[.06] pt-6">
          <ReplyForm action={staffReplyTicket} hidden={{ ticketId: t.id }} placeholder="Votre réponse au client…" label="Répondre" extra={<label className="flex items-center gap-2 text-sm text-ink-soft"><Checkbox name="close" />Fermer après réponse</label>} />
        </div>
      </Card>
    </>
  );
}
