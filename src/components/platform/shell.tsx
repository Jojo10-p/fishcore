"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

export type SubStatus = "TRIAL" | "ACTIVE" | "GRACE" | "EXPIRED" | "SUSPENDED";

export const STATUS_UI: Record<SubStatus, { label: string; tone: "blue" | "green" | "amber" | "red" | "gray" }> = {
  TRIAL: { label: "Essai", tone: "blue" },
  ACTIVE: { label: "Abonné", tone: "green" },
  GRACE: { label: "Échéance dépassée", tone: "amber" },
  EXPIRED: { label: "Expiré", tone: "red" },
  SUSPENDED: { label: "Suspendu", tone: "gray" },
};

export function StatusBadge({ status }: { status: SubStatus }) {
  return <Badge tone={STATUS_UI[status].tone}>{STATUS_UI[status].label}</Badge>;
}

export const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F CFA`;
export const day = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

const NAV = [
  { href: "/plateforme", label: "Vue d'ensemble" },
  { href: "/plateforme/clients", label: "Clients" },
  { href: "/plateforme/offres", label: "Offres & prix" },
];

/** Cadre de l'espace d'administration de la plateforme. */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  };
  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/plateforme" className="flex items-center gap-2 font-bold text-gray-900">
            {/* eslint-disable-next-line @next/next/no-img-element -- icône statique */}
            <img src="/icons/icon.svg" alt="" className="h-7 w-7" />
            {APP_NAME} <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">plateforme</span>
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((n) => {
              const active = n.href === "/plateforme" ? pathname === n.href : pathname.startsWith(n.href) || (n.href === "/plateforme/clients" && pathname.startsWith("/plateforme/entreprises"));
              return (
                <Link key={n.href} href={n.href} className={cn("rounded-lg px-3 py-1.5 font-medium", active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100")}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <button onClick={logout} className="ml-auto text-sm text-red-600 hover:underline">
            Se déconnecter
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
