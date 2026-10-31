import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { FilterBar } from "@/components/admin/filter-bar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/surface";
import { TICKET_STATUS_META } from "@/lib/status";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Assistance" };

export default async function AdminTickets({ searchParams }: { searchParams: Promise<{ q?: string; statut?: string }> }) {
  const sp = await searchParams;
  await requireStaff("messages.manage");
  const where: Prisma.SupportTicketWhereInput = {};
  if (sp.statut === "OPEN" || sp.statut === "ANSWERED" || sp.statut === "CLOSED") where.status = sp.statut;
  if (sp.q) where.OR = [{ subject: { contains: sp.q, mode: "insensitive" } }, { reference: { contains: sp.q, mode: "insensitive" } }, { customer: { lastName: { contains: sp.q, mode: "insensitive" } } }];
  const tickets = await db.supportTicket.findMany({ where, include: { customer: true, application: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 100 });
  return (
    <>
      <PageHeader title="Assistance" text="Conversations ouvertes par les clients depuis leur espace." />
      <FilterBar placeholder="Sujet, référence, client…" filters={[{ name: "statut", label: "Tous les statuts", type: "select", options: Object.entries(TICKET_STATUS_META).map(([k, v]) => ({ value: k, label: v.label })) }]} />
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {tickets.length === 0 ? <EmptyState icon={<LifeBuoy className="h-5 w-5" />} title="Aucune conversation" /> : (
          <ul className="divide-y divide-night/[.06]">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/assistance/${t.id}`} className="flex flex-col gap-2 px-5 py-4 hover:bg-paper/60 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t.subject}</p>
                    <p className="truncate text-sm text-ink-faint">{t.reference} · {t.customer.firstName} {t.customer.lastName}{t.application && ` · ${t.application.reference}`} · {formatDate(t.updatedAt, "fr-FR", true)}</p>
                    {t.messages[0] && <p className="mt-1 truncate text-sm text-ink-soft">{t.messages[0].isStaff ? "Vous : " : ""}{t.messages[0].body}</p>}
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
