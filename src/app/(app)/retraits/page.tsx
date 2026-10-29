"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface PendingSale {
  id: string;
  saleNumber: string;
  createdAt: string;
  totalAmount: string;
  deliveryStatus: "PENDING" | "PARTIAL";
  customer: { name: string; phone: string | null } | null;
  _count: { lines: number };
}
interface RecentDelivery {
  id: string;
  number: number;
  createdAt: string;
  deliveredBy: string;
  sale: { id: string; saleNumber: string; customer: { name: string } | null };
}
interface DeliveriesData {
  pending: PendingSale[];
  exact: { id: string; saleNumber: string; status: string; deliveryStatus: string } | null;
  recent: RecentDelivery[];
}
interface SaleDetail {
  id: string;
  saleNumber: string;
  createdAt: string;
  status: string;
  customer: { name: string; phone: string | null } | null;
  lines: Array<{ id: string; quantity: string; deliveredQuantity: string; unitSymbol: string; product: { name: string } }>;
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

// Retraits au magasin : le client présente sa facture payée, le magasinier
// la scanne et enregistre ce qu'il remet (tout ou partie).
export default function PickupPage() {
  const { centerId } = useSession();
  const [data, setData] = useState<DeliveriesData | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [serving, setServing] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (q = "") => {
      if (!centerId) return null;
      try {
        const r = await apiGet<{ data: DeliveriesData }>(`/api/deliveries?centerId=${centerId}${q ? `&search=${encodeURIComponent(q)}` : ""}`);
        setData(r.data);
        setError(null);
        return r.data;
      } catch (e) {
        setError(errorMessage(e));
        return null;
      }
    },
    [centerId]
  );

  useEffect(() => {
    const t = setTimeout(() => void load(search), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Douchette : le numéro de facture suivi de « Entrée » ouvre directement la remise
  const onScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = search.trim();
    if (!code) return;
    const r = await load(code);
    if (!r) return;
    const hit = r.pending.find((p) => p.saleNumber.toLowerCase() === code.toLowerCase()) ?? (r.pending.length === 1 ? r.pending[0] : null);
    if (hit) {
      setInfo(null);
      setServing(hit.id);
    } else if (r.exact) {
      setInfo(
        r.exact.status === "CANCELLED"
          ? `La facture ${r.exact.saleNumber} est ANNULÉE : ne rien remettre.`
          : r.exact.deliveryStatus === "DELIVERED"
            ? `La facture ${r.exact.saleNumber} a déjà été entièrement servie.`
            : `La facture ${r.exact.saleNumber} dépend d'un autre magasin.`
      );
    } else {
      setInfo(`Aucune facture « ${code} » à servir.`);
    }
  };

  const done = async () => {
    setServing(null);
    setSearch("");
    await load();
    scanRef.current?.focus();
  };

  return (
    <>
      <PageHeader title="Retraits au magasin" description="Scannez la facture présentée par le client, puis remettez la marchandise payée." />
      <Card className="mb-4 p-3 sm:p-4">
        <form onSubmit={onScan} className="flex gap-2">
          <Input
            ref={scanRef}
            autoFocus
            placeholder="Scanner ou saisir le n° de facture (ex. FACT-000012) ou le nom du client"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Facture à servir"
          />
          <Button type="submit">Ouvrir</Button>
        </form>
        {info && (
          <div className="mt-3">
            <Alert tone="amber">{info}</Alert>
          </div>
        )}
      </Card>
      {error && <Alert>{error}</Alert>}

      <Card className="mb-6">
        <h2 className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-900 sm:px-6">
          À servir {data && <span className="text-sm font-normal text-gray-500">({data.pending.length})</span>}
        </h2>
        {!data ? (
          <Spinner />
        ) : data.pending.length === 0 ? (
          <EmptyState icon="✅" title="Rien en attente">
            Toutes les factures payées ont été servies.
          </EmptyState>
        ) : (
          <Table head={["Facture", "Payée le", "Client", "Articles", "État", ""]}>
            {data.pending.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">{s.saleNumber}</Td>
                <Td>{new Date(s.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</Td>
                <Td>{s.customer?.name ?? <span className="text-gray-400">Client comptant</span>}</Td>
                <Td>{s._count.lines}</Td>
                <Td>{s.deliveryStatus === "PARTIAL" ? <Badge tone="amber">Servie en partie</Badge> : <Badge tone="blue">À servir</Badge>}</Td>
                <Td>
                  <Button className="px-3 py-1.5" onClick={() => setServing(s.id)}>
                    Servir
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {data && data.recent.length > 0 && (
        <Card>
          <h2 className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-900 sm:px-6">Derniers retraits</h2>
          <Table head={["Date", "Facture", "Client", "Retrait", "Servi par"]}>
            {data.recent.map((d) => (
              <tr key={d.id}>
                <Td>{new Date(d.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</Td>
                <Td>
                  <Link href={`/facture/${d.sale.id}`} target="_blank" className="text-blue-600 hover:underline">
                    {d.sale.saleNumber}
                  </Link>
                </Td>
                <Td>{d.sale.customer?.name ?? "—"}</Td>
                <Td>n° {d.number}</Td>
                <Td>{d.deliveredBy}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {serving && <ServeModal saleId={serving} onClose={() => setServing(null)} onDone={done} />}
    </>
  );
}

function ServeModal({ saleId, onClose, onDone }: { saleId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: SaleDetail }>(`/api/sales/${saleId}`)
      .then((r) => {
        setSale(r.data);
        // Par défaut : tout ce qui reste à remettre
        setQty(Object.fromEntries(r.data.lines.map((l) => [l.id, String(Math.max(0, Number(l.quantity) - Number(l.deliveredQuantity)))])));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [saleId]);

  const lines = sale?.lines.map((l) => ({ ...l, left: Number(l.quantity) - Number(l.deliveredQuantity) })) ?? [];
  const request = lines
    .map((l) => ({ saleLineId: l.id, quantity: Number((qty[l.id] ?? "0").replace(",", ".")) || 0, left: l.left }))
    .filter((r) => r.quantity > 0);
  const tooMuch = request.some((r) => r.quantity > r.left);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/sales/${saleId}/deliveries`, { lines: request.map(({ saleLineId, quantity }) => ({ saleLineId, quantity })), notes: notes || undefined });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={sale ? `Servir la facture ${sale.saleNumber}` : "Servir"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy} disabled={request.length === 0 || tooMuch}>
            Valider la remise
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {!sale ? (
        <Spinner />
      ) : (
        <>
          <p className="text-sm text-gray-600">
            {sale.customer ? (
              <>
                Client : <strong>{sale.customer.name}</strong>
                {sale.customer.phone && ` (${sale.customer.phone})`}
              </>
            ) : (
              "Client comptant"
            )}{" "}
            · payée le {new Date(sale.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Article</th>
                  <th className="px-3 py-2 text-right font-medium">Payé</th>
                  <th className="px-3 py-2 text-right font-medium">Déjà remis</th>
                  <th className="px-3 py-2 text-left font-medium">Remis maintenant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l) => (
                  <tr key={l.id} className={l.left <= 0 ? "text-gray-400" : ""}>
                    <td className="px-3 py-2 font-medium">{l.product.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmt(Number(l.quantity))} {l.unitSymbol}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(l.deliveredQuantity))}</td>
                    <td className="px-3 py-2">
                      {l.left <= 0 ? (
                        "Remis"
                      ) : (
                        <span className="flex items-center gap-2">
                          <input
                            inputMode="decimal"
                            value={qty[l.id] ?? ""}
                            onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                            aria-label={`Quantité remise de ${l.product.name}`}
                          />
                          <span className="text-xs text-gray-500">sur {fmt(l.left)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tooMuch && <p className="text-xs text-red-600">Impossible de remettre plus que ce qui reste à servir.</p>}
          <Field label="Observation (véhicule, chauffeur…)">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <p className="text-xs text-gray-500">
            Chaque remise est enregistrée à votre nom. Le client peut revenir chercher le reste plus tard avec la même facture.
          </p>
        </>
      )}
    </Modal>
  );
}
