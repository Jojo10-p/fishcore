"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Spinner, Table, Td, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { formatCurrency } from "@/lib/utils";

interface SaleRow {
  id: string;
  saleNumber: string;
  createdAt: string;
  totalAmount: string;
  status: string;
  createdOffline: boolean;
  cashier: { firstName: string; lastName: string };
  payments: Array<{ method: string; amount: string }>;
}

const SALE_STATUS: Record<string, { label: string; tone: "green" | "red" | "amber" | "gray" }> = {
  COMPLETED: { label: "Validée", tone: "green" },
  CANCELLED: { label: "Annulée", tone: "red" },
  PARTIALLY_REFUNDED: { label: "Remb. partiel", tone: "amber" },
  FULLY_REFUNDED: { label: "Remboursée", tone: "amber" },
  DRAFT: { label: "Brouillon", tone: "gray" },
};

export default function SalesPage() {
  const { centerId, currency, can } = useSession();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<SaleRow | null>(null);

  const load = useCallback(async () => {
    if (!centerId) return;
    const from = new Date(`${day}T00:00:00`);
    const to = new Date(`${day}T23:59:59.999`);
    try {
      const res = await apiGet<{ data: SaleRow[] }>(
        `/api/sales?centerId=${centerId}&dateFrom=${from.toISOString()}&dateTo=${to.toISOString()}&limit=200`
      );
      setSales(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [centerId, day]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const total = sales?.filter((s) => s.status !== "CANCELLED").reduce((sum, s) => sum + Number(s.totalAmount), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Ventes"
        description={sales ? `${sales.length} vente(s) · ${formatCurrency(total, currency)} hors annulations` : undefined}
        actions={<Input type="date" aria-label="Jour" value={day} onChange={(e) => setDay(e.target.value)} className="w-auto" />}
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        {!sales ? (
          <Spinner />
        ) : sales.length === 0 ? (
          <EmptyState title="Aucune vente ce jour-là" />
        ) : (
          <Table head={["N°", "Heure", "Caissier", "Paiement", "Montant", "Statut", ""]}>
            {sales.map((s) => (
              <tr key={s.id}>
                <Td>
                  <Link href={`/recu/${s.id}`} target="_blank" className="text-blue-600 hover:underline">
                    {s.saleNumber}
                  </Link>
                  {s.createdOffline && <span className="ml-2"><Badge tone="purple">hors ligne</Badge></span>}
                </Td>
                <Td>{new Date(s.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</Td>
                <Td>
                  {s.cashier.firstName} {s.cashier.lastName}
                </Td>
                <Td className="text-gray-500">{[...new Set(s.payments.map((p) => p.method))].join(" + ")}</Td>
                <Td>
                  <Money value={s.totalAmount} currency={currency} />
                </Td>
                <Td>
                  <Badge tone={SALE_STATUS[s.status]?.tone ?? "gray"}>{SALE_STATUS[s.status]?.label ?? s.status}</Badge>
                </Td>
                <Td>
                  {s.status === "COMPLETED" && can("sale:cancel_request") && (
                    <button className="text-sm text-red-600 hover:underline" onClick={() => setCancelFor(s)}>
                      Demander l&apos;annulation
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <CancelRequestModal sale={cancelFor} onClose={() => setCancelFor(null)} onDone={load} />
    </>
  );
}

function CancelRequestModal({ sale, onClose, onDone }: { sale: SaleRow | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!sale) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/sales/${sale.id}/cancel`, { action: "request", reason });
      setReason("");
      await onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!sale}
      onClose={onClose}
      title={`Annuler la vente ${sale?.saleNumber ?? ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 5}>
            Envoyer la demande
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600">La demande sera examinée par un responsable. La vente reste valide tant qu&apos;elle n&apos;est pas approuvée.</p>
      {error && <Alert>{error}</Alert>}
      <Field label="Motif" hint="Au moins 5 caractères.">
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}
