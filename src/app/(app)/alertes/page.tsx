"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { refreshStockAlertCount } from "@/components/app/stock-alerts";
import { useSession } from "@/components/app/session-provider";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface StockAlertRow {
  id: string;
  createdAt: string;
  quantity: string;
  threshold: string;
  readAt: string | null;
  emailedAt: string | null;
  emailError: string | null;
  resolvedAt: string | null;
  center: { id: string; name: string; code: string };
  product: { id: string; name: string; internalCode: string | null; baseUnit: { symbol: string }; category: { name: string } | null };
}
interface Data {
  open: StockAlertRow[];
  resolved: StockAlertRow[];
  unread: number;
  email: { configured: boolean; forOwner: boolean };
}

const q = (v: string) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const when = (d: string) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function StockAlertsPage() {
  const { session, can } = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData((await apiGet<{ data: Data }>("/api/stock-alerts")).data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(timer);
    };
  }, [load]);

  const markAll = async () => {
    setBusy(true);
    try {
      await apiSend("/api/stock-alerts", { all: true }, "PATCH");
      await Promise.all([load(), refreshStockAlertCount()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ownerEmail = session?.user.role === "COMPANY_OWNER" ? session.user.email : null;

  return (
    <>
      <PageHeader
        title="Alertes de stock"
        description="Les articles descendus à leur seuil d'alerte, boutique par boutique. Une alerte se ferme d'elle-même quand le stock remonte."
        actions={
          <div className="flex flex-wrap gap-2">
            {can("stock:receive") && (
              <Link href="/receptions">
                <Button variant="secondary">🚚 Enregistrer une réception</Button>
              </Link>
            )}
            <Button onClick={markAll} loading={busy} disabled={!data?.unread}>
              Tout marquer comme lu
            </Button>
          </div>
        }
      />
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Alertes en cours" value={data.open.length} tone={data.open.length ? "amber" : undefined} />
            <Stat label="Non lues" value={data.unread} tone={data.unread ? "red" : undefined} />
            <Stat label="En rupture (stock à 0)" value={data.open.filter((a) => Number(a.quantity) <= 0).length} tone={data.open.some((a) => Number(a.quantity) <= 0) ? "red" : undefined} />
          </div>

          {data.email.forOwner && (
            <Alert tone={data.email.configured ? "blue" : "amber"}>
              {data.email.configured ? (
                <>
                  📧 Chaque nouvelle alerte est aussi envoyée par e-mail à <strong>{ownerEmail}</strong>.
                </>
              ) : (
                <>📧 L&apos;envoi des alertes par e-mail n&apos;est pas encore activé sur ce serveur : les alertes restent visibles ici et sur le tableau de bord.</>
              )}
            </Alert>
          )}

          <Card>
            {data.open.length === 0 ? (
              <EmptyState icon="✅" title="Aucun article sous son seuil d'alerte">
                Les seuils se règlent dans la fiche de chaque article (« Seuil d&apos;alerte »).
              </EmptyState>
            ) : (
              <Table head={["Article", "Boutique", "Reste", "Seuil", "Depuis", ""]}>
                {data.open.map((a) => {
                  const out = Number(a.quantity) <= 0;
                  return (
                    <tr key={a.id} className={cn(!a.readAt && "bg-amber-50/60")}>
                      <Td>
                        <div className="flex items-center gap-2">
                          {!a.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" aria-label="Nouvelle" />}
                          <div>
                            <p className="font-medium text-gray-900">{a.product.name}</p>
                            <p className="text-xs text-gray-500">
                              {a.product.internalCode ? `Réf. ${a.product.internalCode}` : ""}
                              {a.product.category ? `${a.product.internalCode ? " · " : ""}${a.product.category.name}` : ""}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td>{a.center.name}</Td>
                      <Td>
                        <Badge tone={out ? "red" : "amber"}>
                          {out ? "Rupture" : `${q(a.quantity)} ${a.product.baseUnit.symbol}`}
                        </Badge>
                      </Td>
                      <Td className="text-gray-600">
                        {q(a.threshold)} {a.product.baseUnit.symbol}
                      </Td>
                      <Td className="text-gray-600">{when(a.createdAt)}</Td>
                      <Td className="text-xs text-gray-500">{a.emailedAt ? "📧 e-mail envoyé" : ""}</Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>

          {data.resolved.length > 0 && (
            <Card>
              <h2 className="px-4 pt-4 font-semibold text-gray-900">Réglées récemment</h2>
              <Table head={["Article", "Boutique", "Alerte du", "Réglée le"]}>
                {data.resolved.map((a) => (
                  <tr key={a.id}>
                    <Td>{a.product.name}</Td>
                    <Td>{a.center.name}</Td>
                    <Td className="text-gray-600">{when(a.createdAt)}</Td>
                    <Td>
                      <Badge tone="green">✓ {when(a.resolvedAt!)}</Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function cn(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : "border-gray-200"}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}
