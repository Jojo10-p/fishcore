import { AppShell, type NavItem } from "@/components/client/app-shell";
import { requireCustomer } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { logout } from "@/server/actions/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { Bell } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mon espace", robots: { index: false } };

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCustomer();
  const settings = await getSettings();
  const [unread, pendingRequests, answered] = await Promise.all([
    db.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } }),
    db.documentRequest.count({ where: { fulfilledAt: null, application: { customerId: user.customer.id, deletedAt: null, status: { notIn: ["CLOSED", "REJECTED"] } } } }),
    db.supportTicket.count({ where: { customerId: user.customer.id, status: "ANSWERED" } }),
  ]);
  const nav: NavItem[] = [
    { href: "/espace", label: "Tableau de bord", icon: "LayoutDashboard", exact: true },
    { href: "/espace/demandes", label: "Mes demandes", icon: "FolderOpen" },
    { href: "/espace/documents", label: "Mes documents", icon: "FileText", badge: pendingRequests },
    { href: "/espace/assistance", label: "Assistance", icon: "LifeBuoy", badge: answered },
    { href: "/espace/notifications", label: "Notifications", icon: "Bell", badge: unread },
    { href: "/espace/profil", label: "Mon profil", icon: "UserRound" },
  ];
  async function doLogout() {
    "use server";
    await logout("/connexion");
  }
  return (
    <AppShell
      nav={nav}
      tone="client"
      orgName={settings.org.name}
      user={{ firstName: user.firstName, lastName: user.lastName, subtitle: user.email }}
      logoutAction={doLogout}
      topRight={
        <>
          <Link href="/espace/notifications" className="relative rounded-full p-2 text-ink-soft hover:bg-mist hover:text-ink" aria-label={`Notifications (${unread} non lues)`}>
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-teal ring-2 ring-paper" />}
          </Link>
          <Link href="/demande" className={buttonVariants({ size: "sm", className: "hidden sm:inline-flex" })}>Nouvelle demande</Link>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
