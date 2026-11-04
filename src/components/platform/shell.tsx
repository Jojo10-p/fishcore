"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { APP_NAME } from "@/lib/app-config";
import { BUSINESS_PROFILES } from "@/lib/business-profiles";
import { cn } from "@/lib/utils";

export const fcfa = (n: number) =>
  `${Math.round(n).toLocaleString("fr-FR")} F CFA`;
export const day = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";
export const metier = (t: string) =>
  BUSINESS_PROFILES[t as keyof typeof BUSINESS_PROFILES]?.label ?? t;
export const ago = (d: string | null | undefined) => {
  if (!d) return "jamais";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} j`;
};

export function StateBadge({
  isActive,
  inactive,
}: {
  isActive: boolean;
  inactive?: boolean;
}) {
  if (!isActive) return <Badge tone="red">Suspendue</Badge>;
  if (inactive) return <Badge tone="amber">Inactive</Badge>;
  return <Badge tone="green">Active</Badge>;
}

const NAV = [
  {
    href: "/plateforme",
    label: "Vue d'ensemble",
    match: (p: string) => p === "/plateforme",
  },
  {
    href: "/plateforme/clients",
    label: "Entreprises",
    match: (p: string) =>
      p.startsWith("/plateforme/clients") ||
      p.startsWith("/plateforme/entreprises"),
  },
  {
    href: "/plateforme/departs",
    label: "Départs",
    match: (p: string) => p.startsWith("/plateforme/departs"),
  },
];

/** Cadre de la console du créateur de la plateforme. */
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
          <Link
            href="/plateforme"
            className="flex items-center gap-2 font-bold text-gray-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- icône statique */}
            <img src="/icons/icon-192.png" alt="" className="h-7 w-7" />
            {APP_NAME}{" "}
            <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
              console
            </span>
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 font-medium",
                  n.match(pathname)
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <button
            onClick={logout}
            className="ml-auto text-sm text-red-600 hover:underline"
          >
            Se déconnecter
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
