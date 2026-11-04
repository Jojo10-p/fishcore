"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { InstallInvite } from "@/components/app/install-app";
import { PushNotificationsCard } from "@/components/app/push-notifications";
import { Alert, Badge, Card, Input, Money, PageHeader, Spinner } from "@/components/ui";
import { apiGet, errorMessage } from "@/lib/client/api";
import { APP_NAME, LOW_STOCK_THRESHOLD } from "@/lib/app-config";

interface DashboardData {
  date: string;
  today: { salesCount: number; revenue: number };
  lowStockCount: number;
  lowStock: Array<{ productId: string; name: string; quantity: number; unit: string; center: string }>;
  openSessions: number;
  recentSales: Array<{
    id: string;
    saleNumber: string;
    totalAmount: string;
    status: string;
    createdAt: string;
    createdOffline: boolean;
    cashier: { firstName: string; lastName: string };
  }>;
}

const STATUS: Record<string, { label: string; tone: "green" | "red" | "amber" | "gray" }> = {
  COMPLETED: { label: "Payée", tone: "green" },
  CANCELLED: { label: "Annulée", tone: "red" },
  PARTIALLY_REFUNDED: { label: "Remb. partiel", tone: "amber" },
  FULLY_REFUNDED: { label: "Remboursée", tone: "amber" },
  DRAFT: { label: "Brouillon", tone: "gray" },
};

const qty = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

// Tableau de bord GJH : l'essentiel du jour, en un coup d'œil (ordinateur ou téléphone)
export default function DashboardPage() {
  const { can, centerId, currency, session } = useSession();
  const router = useRouter();
  const isOwner = session?.user.role === "COMPANY_OWNER";
  const [consolidated, setConsolidated] = useState(isOwner);
  const [date, setDate] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // La caisse arrive directement sur l'écran de vente
  useEffect(() => {
    if (session && !can("report:view")) router.replace(can("sale:create") ? "/caisse" : "/stock");
  }, [session, can, router]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (!consolidated && centerId) params.set("centerId", centerId);
    if (date) params.set("date", date);
    try {
      const res = await apiGet<{ data: DashboardData }>(`/api/reports/dashboard?${params}`);
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [consolidated, centerId, date]);

  useEffect(() => {
    if (!can("report:view")) return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, can]);

  const isToday = !date;

  return (
    <>
      <PageHeader
        title={`Bonjour ${session?.user.firstName ?? ""}`.trim()}
        description={isToday ? "Voici la journée de la boutique, en direct." : "Journée sélectionnée"}
        actions={
          <>
            {isOwner && (session?.centers.length ?? 0) > 1 && (
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg px-3">
                <input type="checkbox" checked={consolidated} onChange={(e) => setConsolidated(e.target.checked)} />
                Toutes les boutiques
              </label>
            )}
            <Input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          </>
        }
      />

      <div className="space-y-5">
        <PushNotificationsCard />
        <InstallInvite appName={APP_NAME} logoUrl="/icons/icon-192.png" />

        {/* Raccourcis */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {can("sale:create") && (
            <Link href="/caisse" className="flex items-center gap-3 rounded-2xl bg-blue-600 p-4 sm:p-5 text-white shadow-sm hover:bg-blue-700">
              <span className="text-3xl" aria-hidden>🛒</span>
              <span>
                <span className="block text-base sm:text-lg font-bold">Nouvelle vente</span>
                <span className="block text-xs sm:text-sm text-blue-100">Encaisser et imprimer le ticket</span>
              </span>
            </Link>
          )}
          {can("stock:receive") && (
            <Link href="/receptions" className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm hover:border-blue-300">
              <span className="text-3xl" aria-hidden>🚚</span>
              <span>
                <span className="block text-base sm:text-lg font-bold text-gray-900">Ajouter du stock</span>
                <span className="block text-xs sm:text-sm text-gray-500">Marchandise reçue du fournisseur</span>
              </span>
            </Link>
          )}
        </div>

        {error && <Alert>{error}</Alert>}
        {!data && !error && <Spinner />}

        {data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <Kpi label="Encaissé" value={<Money value={data.today.revenue} currency={currency} />} />
              <Kpi label="Ventes" value={data.today.salesCount} />
              <Kpi
                label={`Presque épuisés (${LOW_STOCK_THRESHOLD} ou moins)`}
                value={data.lowStockCount}
                tone={data.lowStockCount > 0 ? "amber" : undefined}
                href="/stock?alerte=1"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">À recommander</h2>
                  <Link href="/stock?alerte=1" className="text-sm text-blue-600 hover:underline">
                    Tout le stock
                  </Link>
                </div>
                {data.lowStock.length === 0 ? (
                  <p className="px-4 sm:px-6 py-6 text-sm text-gray-500">Aucun article sous {LOW_STOCK_THRESHOLD}. Tout va bien.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {data.lowStock.map((r) => (
                      <li key={r.productId + r.center} className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-gray-900">{r.name}</span>
                          {(session?.centers.length ?? 0) > 1 && <span className="block text-xs text-gray-500">{r.center}</span>}
                        </span>
                        <Badge tone={r.quantity <= 0 ? "red" : "amber"}>{r.quantity <= 0 ? "Épuisé" : `Plus que ${qty(r.quantity)} ${r.unit}`}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">Dernières ventes</h2>
                  <Link href="/ventes" className="text-sm text-blue-600 hover:underline">
                    Tout voir
                  </Link>
                </div>
                {data.recentSales.length === 0 ? (
                  <p className="px-4 sm:px-6 py-6 text-sm text-gray-500">Pas encore de vente.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {data.recentSales.slice(0, 8).map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 text-sm">
                        <span className="min-w-0">
                          <Link href={`/recu/${s.id}`} className="font-medium text-blue-600 hover:underline">
                            {s.saleNumber}
                          </Link>
                          <span className="block text-xs text-gray-500">
                            {new Date(s.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {s.cashier.firstName}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="font-semibold text-gray-900">
                            <Money value={s.totalAmount} currency={currency} />
                          </span>
                          {s.status !== "COMPLETED" && <Badge tone={STATUS[s.status]?.tone ?? "gray"}>{STATUS[s.status]?.label ?? s.status}</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, tone, href }: { label: string; value: React.ReactNode; tone?: "amber"; href?: string }) {
  const body = (
    <Card className={`p-4 sm:p-5 h-full ${tone === "amber" ? "border-amber-300 bg-amber-50" : ""} ${href ? "hover:border-blue-300" : ""}`}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">{value}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
