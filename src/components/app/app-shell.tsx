"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Permission } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { clearSessionCache, useSession } from "@/components/app/session-provider";
import { ConnectionBadge } from "@/components/app/connection-badge";
import { Select, Spinner } from "@/components/ui";
import { getPendingSyncCount } from "@/lib/offline/sync";
import { APP_NAME } from "@/lib/app-config";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Visible si l'utilisateur a AU MOINS une de ces permissions (vide = tout le monde). */
  any: Permission[];
  /** Seulement si l'entreprise sert la marchandise au magasin sur présentation de la facture. */
  pickupOnly?: boolean;
}

// Chaque rôle ne voit que ce qui sert à son travail (cahier §2.1, §20)
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", icon: "📊", any: ["report:view"] },
  { href: "/caisse", label: "Caisse", icon: "🛒", any: ["sale:create"] },
  { href: "/ventes", label: "Ventes & factures", icon: "🧾", any: ["sale:view"] },
  { href: "/devis", label: "Devis", icon: "📝", any: ["quote:view"] },
  { href: "/retraits", label: "Retraits magasin", icon: "📤", any: ["sale:deliver"], pickupOnly: true },
  { href: "/annulations", label: "Annulations", icon: "↩️", any: ["sale:cancel_request", "sale:cancel_approve"] },
  { href: "/produits", label: "Articles", icon: "🏷️", any: ["product:create", "product:edit"] },
  { href: "/stock", label: "Stock", icon: "📦", any: ["stock:view"] },
  { href: "/receptions", label: "Réceptions", icon: "🚚", any: ["stock:receive"] },
  { href: "/caisses", label: "Caisses & clôtures", icon: "💰", any: ["cash:view_all_sessions"] },
  { href: "/finances", label: "Finances", icon: "📈", any: ["report:view"] },
  { href: "/depenses", label: "Dépenses", icon: "💸", any: ["expense:view"] },
  { href: "/clients", label: "Clients", icon: "👤", any: ["customer:view"] },
  { href: "/fournisseurs", label: "Fournisseurs & dettes", icon: "🏭", any: ["purchase:view"] },
  { href: "/utilisateurs", label: "Utilisateurs", icon: "👥", any: ["user:view"] },
  { href: "/parametres", label: "Paramètres", icon: "⚙️", any: ["company:edit"] },
  { href: "/synchronisation", label: "Synchronisation", icon: "🔄", any: [] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, can, centerId, setCenterId, fromCache } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const pickup = !!session?.company?.requiresPickup;
  const items = NAV.filter((n) => (!n.pickupOnly || pickup) && (n.any.length === 0 || n.any.some((p) => can(p))));

  if (loading) return <Spinner />;
  if (!session) {
    return (
      <div className="p-8 text-center text-sm text-gray-600">
        Session indisponible. <Link className="text-blue-600 underline" href="/login">Se connecter</Link>
      </div>
    );
  }

  const logout = async () => {
    const pending = await getPendingSyncCount().catch(() => 0);
    if (pending > 0 && !window.confirm(`${pending} opération(s) ne sont pas encore envoyées au serveur. Elles resteront sur cet appareil. Se déconnecter quand même ?`)) {
      return;
    }
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    clearSessionCache();
    router.replace("/login");
  };

  const nav = (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMenuOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-100"
            )}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const centerPicker =
    session.centers.length > 1 ? (
      <Select aria-label="Centre" value={centerId ?? ""} onChange={(e) => setCenterId(e.target.value)}>
        {session.centers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.code})
          </option>
        ))}
      </Select>
    ) : session.centers[0] ? (
      <p className="text-sm text-gray-600 px-1">{session.centers[0].name}</p>
    ) : null;

  const userBox = (
    <div className="border-t border-gray-200 pt-4 mt-4 space-y-3">
      <div className="px-1">
        <p className="text-sm font-medium text-gray-900 truncate">
          {session.user.firstName} {session.user.lastName}
        </p>
        <p className="text-xs text-gray-500 truncate">{session.company?.tradeName}</p>
      </div>
      <button onClick={logout} disabled={loggingOut} className="w-full text-left text-sm text-red-600 hover:bg-red-50 rounded-lg px-3 py-2">
        {loggingOut ? "Déconnexion…" : "Se déconnecter"}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-gray-50 lg:flex">
      {/* Barre latérale (ordinateur) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-gray-200 p-4">
        <Link href="/dashboard" className="flex items-center gap-2 px-1 mb-6">
          <img src="/icons/icon.svg" alt="" className="h-8 w-8" />
          <span className="font-bold text-gray-900">{APP_NAME}</span>
        </Link>
        <div className="mb-4">{centerPicker}</div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        {userBox}
      </aside>

      {/* Barre du haut (téléphone / tablette) */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 bg-white border-b border-gray-200 px-4 py-3">
        <button onClick={() => setMenuOpen(true)} className="text-2xl leading-none" aria-label="Ouvrir le menu">
          ☰
        </button>
        <span className="font-bold text-gray-900 truncate">{session.company?.tradeName ?? APP_NAME}</span>
        <ConnectionBadge compact />
      </header>

      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">{centerPicker}</div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {userBox}
          </div>
        </div>
      )}

      <main className="flex-1 lg:pl-64 min-w-0">
        <div className="hidden lg:flex justify-end px-8 pt-4">
          <ConnectionBadge />
        </div>
        {fromCache && (
          <div className="mx-4 lg:mx-8 mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-900">
            Hors connexion : les informations affichées peuvent ne pas être à jour.
          </div>
        )}
        <div className="px-4 py-6 lg:px-8">{children}</div>
      </main>
      <PendingBeacon />
    </div>
  );
}

/** Rappel discret : ventes locales encore à envoyer. */
function PendingBeacon() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const tick = () => void getPendingSyncCount().then(setPending).catch(() => undefined);
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (pending === 0) return null;
  return (
    <Link
      href="/synchronisation"
      className="fixed bottom-4 right-4 z-30 rounded-full bg-amber-500 text-white text-sm font-semibold px-4 py-2 shadow-lg"
    >
      {pending} en attente d&apos;envoi
    </Link>
  );
}
