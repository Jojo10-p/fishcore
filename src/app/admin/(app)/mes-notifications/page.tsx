import Link from "next/link";
import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { EmptyState } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { markStaffNotificationsRead } from "@/server/actions/admin/manage";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Mes notifications" };

export default async function StaffNotifications() {
  const me = await requireStaff();
  const items = await db.notification.findMany({ where: { userId: me.id, channel: "IN_APP" }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title="Mes notifications" actions={items.some((n) => !n.readAt) ? <form action={markStaffNotificationsRead}><Button size="sm" variant="outline" type="submit">Tout marquer comme lu</Button></form> : undefined} />
      <div className="overflow-hidden rounded-2xl border border-night/[.07] bg-white">
        {items.length === 0 ? <EmptyState icon={<Bell className="h-5 w-5" />} title="Aucune notification" /> : (
          <ul className="divide-y divide-night/[.06]">
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? "" : "bg-teal-50/40"}>
                <Link href={n.link ?? "#"} className="flex gap-4 px-5 py-4"><span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "" : "bg-teal"}`} /><div><p className="font-medium">{n.title}</p><p className="text-sm text-ink-soft">{n.body}</p><p className="mt-1 text-xs text-ink-faint">{formatDate(n.createdAt, "fr-FR", true)}</p></div></Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
