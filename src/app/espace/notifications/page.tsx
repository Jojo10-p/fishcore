import Link from "next/link";
import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { requireCustomer } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { EmptyState } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { markNotificationsRead } from "@/server/actions/customer";
import { formatDate } from "@/lib/utils";

export default async function NotificationsPage() {
  const user = await requireCustomer();
  const items = await db.notification.findMany({ where: { userId: user.id, channel: "IN_APP" }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.some((n) => !n.readAt);
  return (
    <>
      <PageHeader title="Notifications" actions={unread ? <form action={markNotificationsRead}><Button size="sm" variant="outline" type="submit">Tout marquer comme lu</Button></form> : undefined} />
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {items.length === 0 ? <EmptyState icon={<Bell className="h-5 w-5" />} title="Aucune notification" text="Vous serez notifié(e) ici à chaque évolution de vos dossiers." /> : (
          <ul className="divide-y divide-night/[.06]">
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? "" : "bg-teal-50/40"}>
                <Link href={n.link ?? "#"} className="flex gap-4 px-5 py-4 sm:px-6">
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-teal"}`} />
                  <div><p className="font-medium">{n.title}</p><p className="text-sm text-ink-soft">{n.body}</p><p className="mt-1 text-xs text-ink-faint">{formatDate(n.createdAt, "fr-FR", true)}</p></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
