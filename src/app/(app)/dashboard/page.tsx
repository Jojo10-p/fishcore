"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { InstallInvite } from "@/components/app/install-app";
import { useStockAlertCount } from "@/components/app/stock-alerts";
import { Alert, Badge, Card, Input, Money, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { apiGet, errorMessage } from "@/lib/client/api";

interface DashboardData {
  date: string;
  today: { salesCount: number; revenue: number };
  lowStockCount: number;
  expiredBatches: number;
  expiringBatches: number;
  openSessions: number;
  hourlyRevenue: Array<{ hour: string; revenue: number; count: number }>;
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
  COMPLETED: { label: "Validée", tone: "green" },
  CANCELLED: { label: "Annulée", tone: "red" },
  PARTIALLY_REFUNDED: { label: "Remb. partiel", tone: "amber" },
  FULLY_REFUNDED: { label: "Remboursée", tone: "amber" },
  DRAFT: { label: "Brouillon", tone: "gray" },
};

export default function DashboardPage() {
  const { can, centerId, currency, session } = useSession();
  const newAlerts = useStockAlertCount();
  const router = useRouter();
  const isOwner = session?.user.role === "COMPANY_OWNER";
  const [consolidated, setConsolidated] = useState(isOwner);
  const [date, setDate] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Les rôles sans accès aux rapports arrivent directement sur leur outil
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
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, can]);

  const maxHour = Math.max(1, ...(data?.hourlyRevenue.map((h) => h.revenue) ?? [1]));
  const centerName = session?.centers.find((c) => c.id === centerId)?.name;

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={consolidated ? "Tous vos centres" : centerName ? `Centre : ${centerName}` : undefined}
        actions={
          <>
            {isOwner && (session?.centers.length ?? 0) > 1 && (
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg px-3">
                <input type="checkbox" checked={consolidated} onChange={(e) => setConsolidated(e.target.checked)} />
                Vue consolidée
              </label>
            )}
            <Input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          </>
        }
      />

      {newAlerts > 0 && (
        <Link href="/alertes" className="mb-4 block">
          <Alert tone="amber">
            🔔 <strong>{newAlerts} nouvelle{newAlerts > 1 ? "s" : ""} alerte{newAlerts > 1 ? "s" : ""} de stock</strong> : des articles sont descendus à leur seuil. Voir les articles à recommander →
          </Alert>
        </Link>
      )}
      {session?.company && <InstallInvite appName={session.company.appName || session.company.tradeName} logoUrl={`/api/brand/${session.company.id}/icon-192.png`} />}
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner />}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Kpi label="Chiffre d'affaires" value={<Money value={data.today.revenue} currency={currency} />} />
            <Kpi label="Ventes" value={data.today.salesCount} />
            <Kpi
              label="Stocks en alerte"
              value={data.lowStockCount}
              tone={data.lowStockCount > 0 ? "amber" : undefined}
              href="/stock?alerte=1"
            />
            <Kpi label="Caisses ouvertes" value={data.openSessions} href={can("cash:view_all_sessions") ? "/caisses" : undefined} />
          </div>

          {(data.expiredBatches > 0 || data.expiringBatches > 0) && (
            <Link href="/stock" className="block">
              <Alert tone={data.expiredBatches > 0 ? "red" : "amber"}>
                {data.expiredBatches > 0 && <strong>{data.expiredBatches} lot(s) périmé(s) encore en stock — à retirer de la vente. </strong>}
                {data.expiringBatches > 0 && <span>{data.expiringBatches} lot(s) arrivent à péremption dans les 30 jours.</span>}
              </Alert>
            </Link>
          )}

          <Card className="p-4 sm:p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Ventes par heure</h2>
            <div className="flex items-end gap-1 h-40" role="img" aria-label="Chiffre d'affaires par heure">
              {data.hourlyRevenue.map((h) => (
                <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full group">
                  <div
                    className="w-full rounded-t bg-blue-500 group-hover:bg-blue-600 min-h-[2px]"
                    style={{ height: `${(h.revenue / maxHour) * 100}%` }}
                    title={`${h.hour} : ${h.count} vente(s)`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>0h</span>
              <span>6h</span>
              <span>12h</span>
              <span>18h</span>
              <span>23h</span>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Dernières ventes</h2>
              <Link href="/ventes" className="text-sm text-blue-600 hover:underline">
                Tout voir
              </Link>
            </div>
            <Table head={["N°", "Heure", "Caissier", "Montant", "Statut"]}>
              {data.recentSales.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/recu/${s.id}`} className="text-blue-600 hover:underline">
                      {s.saleNumber}
                    </Link>
                    {s.createdOffline && <span className="ml-2"><Badge tone="purple">hors ligne</Badge></span>}
                  </Td>
                  <Td>{new Date(s.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</Td>
                  <Td>
                    {s.cashier.firstName} {s.cashier.lastName}
                  </Td>
                  <Td>
                    <Money value={s.totalAmount} currency={currency} />
                  </Td>
                  <Td>
                    <Badge tone={STATUS[s.status]?.tone ?? "gray"}>{STATUS[s.status]?.label ?? s.status}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, tone, href }: { label: string; value: React.ReactNode; tone?: "amber"; href?: string }) {
  const body = (
    <Card className={`p-4 h-full ${tone === "amber" ? "border-amber-300 bg-amber-50" : ""} ${href ? "hover:border-blue-300" : ""}`}>
      <p className="text-xs sm:text-sm text-gray-500">{label}</p>
      <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
