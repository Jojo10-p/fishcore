import Link from "next/link";
import { Bell, ExternalLink } from "lucide-react";
import { AppShell, type NavItem } from "@/components/client/app-shell";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { logout } from "@/server/actions/auth";
import { db } from "@/lib/db";
import type { PermissionKey } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Back-office", template: "%s — Back-office" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const settings = await getSettings();
  const [newApps, newMessages, openTickets, unread] = await Promise.all([
    user.can("applications.view") ? db.loanApplication.count({ where: { status: "NEW", deletedAt: null } }) : 0,
    user.can("messages.manage") ? db.contactMessage.count({ where: { status: "NEW" } }) : 0,
    user.can("messages.manage") ? db.supportTicket.count({ where: { status: "OPEN" } }) : 0,
    db.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } }),
  ]);
  const all: (NavItem & { perm?: PermissionKey })[] = [
    { href: "/admin", label: "Tableau de bord", icon: "LayoutDashboard", exact: true, perm: "dashboard.view" },
    { href: "/admin/demandes", label: "Demandes", icon: "FolderOpen", badge: newApps, perm: "applications.view" },
    { href: "/admin/clients", label: "Clients", icon: "Users", perm: "customers.view" },
    { href: "/admin/offres", label: "Offres", icon: "Package", perm: "products.view" },
    { href: "/admin/assistance", label: "Assistance", icon: "LifeBuoy", badge: openTickets, perm: "messages.manage" },
    { href: "/admin/messages", label: "Messages de contact", icon: "Mail", badge: newMessages, perm: "messages.manage" },
    { href: "/admin/contenus", label: "Contenus du site", icon: "PenSquare", perm: "content.manage" },
    { href: "/admin/faq", label: "FAQ", icon: "HelpCircle", perm: "faq.manage" },
    { href: "/admin/temoignages", label: "Témoignages", icon: "Quote", perm: "testimonials.manage" },
    { href: "/admin/notifications", label: "Emails & notifications", icon: "Bell", perm: "notifications.manage" },
    { href: "/admin/utilisateurs", label: "Administrateurs", icon: "ShieldCheck", perm: "users.manage" },
    { href: "/admin/parametres", label: "Paramètres", icon: "Settings", perm: "settings.manage" },
    { href: "/admin/audit", label: "Journal d'audit", icon: "ScrollText", perm: "audit.view" },
  ];
  const nav = all.filter((n) => !n.perm || user.can(n.perm)).map(({ perm: _p, ...n }) => n);
  async function doLogout() {
    "use server";
    await logout("/admin/connexion");
  }
  return (
    <AppShell
      nav={nav}
      tone="admin"
      orgName={settings.org.name}
      user={{ firstName: user.firstName, lastName: user.lastName, subtitle: user.roleName ?? "Équipe" }}
      logoutAction={doLogout}
      topRight={
        <>
          {!settings.compliance.licensed && <Link href={user.can("settings.manage") ? "/admin/parametres#conformite" : "#"} className="hidden rounded-full bg-champagne-50 px-3 py-1.5 text-xs font-medium text-champagne-700 sm:inline-block">Mode pré-agrément : décisions désactivées</Link>}
          <Link href="/admin/mes-notifications" className="relative rounded-full p-2 text-ink-soft hover:bg-white hover:text-ink" aria-label={`Notifications (${unread} non lues)`}>
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="tabular absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-teal px-1 text-[10px] font-bold text-night">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <Link href="/" target="_blank" className="rounded-full p-2 text-ink-soft hover:bg-white hover:text-ink" aria-label="Voir le site"><ExternalLink className="h-5 w-5" /></Link>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
