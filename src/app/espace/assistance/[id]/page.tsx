import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireCustomer } from "@/server/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/client/shared";
import { TicketThread } from "@/components/client/ticket-thread";
import { ReplyForm } from "@/components/client/reply-form";
import { replyTicket } from "@/server/actions/customer";
import { TICKET_STATUS_META } from "@/lib/status";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireCustomer();
  const t = await db.supportTicket.findFirst({ where: { id, customerId: user.customer.id }, include: { application: true, messages: { include: { author: true }, orderBy: { createdAt: "asc" } } } });
  if (!t) notFound();
  return (
    <>
      <Link href="/espace/assistance" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ChevronLeft className="h-4 w-4" />Assistance</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-faint">{t.reference}{t.application && <> · dossier <Link className="underline" href={`/espace/demandes/${t.application.id}`}>{t.application.reference}</Link></>}</p>
          <h1 className="mt-1 text-[1.7rem] font-extrabold">{t.subject}</h1>
        </div>
        <Badge tone={TICKET_STATUS_META[t.status].tone}>{TICKET_STATUS_META[t.status].label}</Badge>
      </div>
      <Card className="max-w-3xl">
        <TicketThread messages={t.messages} viewer="client" />
        <div className="mt-8 border-t border-night/[.06] pt-6">
          {t.status === "CLOSED" ? <p className="text-sm text-ink-faint">Cette conversation est fermée. Ouvrez une nouvelle demande si besoin.</p> : <ReplyForm action={replyTicket} hidden={{ ticketId: t.id }} />}
        </div>
      </Card>
    </>
  );
}
