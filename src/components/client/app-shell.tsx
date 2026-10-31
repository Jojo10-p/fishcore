"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Menu, X, LogOut, LayoutDashboard, FolderOpen, FileText, UserRound, LifeBuoy, Bell, Users, Package, PenSquare,
  MessageSquare, Mail, ShieldCheck, Settings, ScrollText, Quote, HelpCircle,
} from "lucide-react";

const Icons = { LayoutDashboard, FolderOpen, FileText, UserRound, LifeBuoy, Bell, Users, Package, PenSquare, MessageSquare, Mail, ShieldCheck, Settings, ScrollText, Quote, HelpCircle };
import { Logo } from "@/components/ui/logo";
import { cn, initials } from "@/lib/utils";

export interface NavItem { href: string; label: string; icon: keyof typeof Icons; badge?: number; exact?: boolean }

/** Coquille applicative partagée par l'espace client (clair) et le back-office (sombre). */
export function AppShell({ nav, user, orgName, tone, logoutAction, children, topRight }: {
  nav: NavItem[];
  user: { firstName: string; lastName: string; subtitle: string };
  orgName: string;
  tone: "client" | "admin";
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
  topRight?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const dark = tone === "admin";
  const active = (n: NavItem) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(n.href + "/"));

  const Sidebar = (
    <div className={cn("flex h-full flex-col", dark ? "bg-night text-white" : "bg-white")}>
      <div className="flex h-16 items-center px-6">
        <Link href={dark ? "/admin" : "/"}><Logo name={orgName} invert={dark} /></Link>
      </div>
      {dark && <p className="px-6 pb-2 text-[11px] font-semibold text-champagne">Back-office</p>}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Navigation">
        {nav.map((n) => {
          const Icon = Icons[n.icon];
          const on = active(n);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] transition",
                dark ? (on ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white") : on ? "bg-night text-white" : "text-ink-soft hover:bg-mist hover:text-ink",
              )}
            >
              <Icon className={cn("h-[18px] w-[18px]", on && dark && "text-teal")} strokeWidth={1.8} />
              <span className="flex-1">{n.label}</span>
              {!!n.badge && <span className={cn("tabular rounded-full px-2 py-0.5 text-[11px] font-semibold", dark ? "bg-teal text-night" : on ? "bg-white/15" : "bg-teal-50 text-teal-700")}>{n.badge}</span>}
            </Link>
          );
        })}
      </nav>
      <div className={cn("m-3 flex items-center gap-3 rounded-2xl p-3", dark ? "bg-white/5" : "bg-paper")}>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold", dark ? "bg-champagne text-night" : "bg-night text-white")}>{initials(user.firstName, user.lastName)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{user.firstName} {user.lastName}</p>
          <p className={cn("truncate text-xs", dark ? "text-white/50" : "text-ink-faint")}>{user.subtitle}</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className={cn("rounded-lg p-2", dark ? "text-white/60 hover:bg-white/10 hover:text-white" : "text-ink-faint hover:bg-mist hover:text-ink")} aria-label="Se déconnecter" title="Se déconnecter">
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className={cn("min-h-screen", dark ? "bg-[#F3F5F8]" : "bg-paper")}>
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden w-64 border-r lg:block", dark ? "border-transparent" : "border-night/[.07]")}>{Sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-night/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 shadow-lift">{Sidebar}</div>
        </div>
      )}
      <div className="lg:pl-64">
        <header className={cn("sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 backdrop-blur sm:px-6 lg:px-10", dark ? "border-night/[.06] bg-[#F3F5F8]/85" : "border-night/[.06] bg-paper/85")}>
          <button type="button" className="-ml-1 rounded-lg p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          <div className="lg:hidden"><Logo name={orgName} /></div>
          <div className="ml-auto flex items-center gap-2">{topRight}</div>
        </header>
        <main id="contenu" className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, text, actions }: { title: string; text?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[1.9rem] font-extrabold leading-tight">{title}</h1>
        {text && <p className="mt-1.5 text-ink-soft">{text}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
