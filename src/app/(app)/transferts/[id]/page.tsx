"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, Field, Modal, Money, PageHeader, Spinner, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface Transfer {
  id: string;
  number: string;
  status: "IN_TRANSIT" | "RECEIVED" | "CANCELLED";
  createdAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  receptionNotes: string | null;
  createdBy: string | null;
  receivedBy: string | null;
  cancelledBy: string | null;
  canReceive: boolean;
  canCancel: boolean;
  fromCenter: { name: string };
  toCenter: { name: string };
  lines: Array<{
    id: string;
    quantity: string;
    receivedQty: string | null;
    unitCost: string;
    batches: Array<{ lotNumber: string | null; expiresAt: string | null; quantity: string }> | null;
    product: { name: string; internalCode: string | null; baseUnit: { symbol: string; allowsDecimal: boolean } };
  }>;
}

const n = (v: string | number | null) => (v === null ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 }));

export default function TransferPage() {
  const { id } = useParams<{ id: string }>();
  const { currency, can } = useSession();
  const [tr, setTr] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [receptionNotes, setReceptionNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ data: Transfer }>(`/api/transfers/${id}`);
      setTr(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const receiving = tr?.canReceive && can("stock:transfer");

  const receive = async () => {
    if (!tr) return;
    const lines = tr.lines.map((l) => ({ lineId: l.id, receivedQty: Number((received[l.id] ?? l.quantity).toString().replace(",", ".")) }));
    const missing = lines.some((l, i) => l.receivedQty < Number(tr.lines[i].quantity));
    if (!window.confirm(missing ? "Certaines quantités reçues sont inférieures à l'expédié : l'écart sera enregistré comme manquant. Confirmer la réception ?" : "Confirmer la réception de toute la marchandise ?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { missingValue: string } }>(`/api/transfers/${id}/receive`, { lines, notes: receptionNotes.trim() || undefined });
      setNotice(Number(res.data.missingValue) > 0 ? "Réception enregistrée. Le manquant est tracé sur le bon de transfert." : "Réception enregistrée : la marchandise est entrée dans le stock de ce centre.");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !tr) return <Alert>{error}</Alert>;
  if (!tr) return <Spinner />;

  const tone = { IN_TRANSIT: "amber", RECEIVED: "green", CANCELLED: "gray" } as const;
  const label = { IN_TRANSIT: "En transit", RECEIVED: "Reçu", CANCELLED: "Annulé" } as const;
  const value = tr.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);

  return (
    <>
      <PageHeader
        title={`Transfert ${tr.number}`}
        description={`${tr.fromCenter.name} → ${tr.toCenter.name} · expédié le ${formatDate(tr.createdAt, true)}${tr.createdBy ? ` par ${tr.createdBy}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/transferts">
              <Button variant="secondary">← Transferts</Button>
            </Link>
            <a href={`/transfert/${tr.id}`} target="_blank" rel="noreferrer">
              <Button variant="secondary">🖨 Bon de transfert</Button>
            </a>
            {tr.canCancel && can("stock:transfer") && (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Annuler le transfert
              </Button>
            )}
          </div>
        }
      />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={tone[tr.status]}>{label[tr.status]}</Badge>
        <span className="text-sm text-gray-600">
          Valeur au coût moyen : <Money value={value} currency={currency} />
        </span>
        {tr.receivedAt && <span className="text-sm text-gray-600">Reçu le {formatDate(tr.receivedAt, true)}{tr.receivedBy ? ` par ${tr.receivedBy}` : ""}</span>}
        {tr.cancelledAt && <span className="text-sm text-gray-600">Annulé le {formatDate(tr.cancelledAt, true)}{tr.cancelledBy ? ` par ${tr.cancelledBy}` : ""}</span>}
      </div>
      {tr.status === "IN_TRANSIT" && !tr.canReceive && <Alert tone="blue">En route vers {tr.toCenter.name} : la réception se fait depuis ce centre.</Alert>}

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">Réf.</th>
                <th className="px-4 py-3 font-medium">Article</th>
                <th className="px-4 py-3 font-medium text-right">Expédié</th>
                <th className="px-4 py-3 font-medium text-right">Reçu</th>
                <th className="px-4 py-3 font-medium text-right">Valeur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tr.lines.map((l) => {
                const gap = l.receivedQty === null ? 0 : Number(l.quantity) - Number(l.receivedQty);
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{l.product.internalCode ?? ""}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{l.product.name}</div>
                      {l.batches && l.batches.length > 0 && (
                        <div className="text-xs text-gray-500">
                          {l.batches.map((b) => `Lot ${b.lotNumber ?? "—"} : ${n(b.quantity)}${b.expiresAt ? ` (DLC ${formatDate(b.expiresAt)})` : ""}`).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {n(l.quantity)} <span className="text-xs text-gray-500">{l.product.baseUnit.symbol}</span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {receiving ? (
                        <input
                          inputMode="decimal"
                          aria-label={`Quantité reçue ${l.product.name}`}
                          className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-right"
                          value={received[l.id] ?? String(Number(l.quantity))}
                          onChange={(e) => setReceived((r) => ({ ...r, [l.id]: e.target.value }))}
                        />
                      ) : (
                        <>
                          {n(l.receivedQty)}
                          {gap > 0 && <span className="ml-2 text-xs text-red-600">−{n(gap)}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap text-gray-600">
                      <Money value={Number(l.quantity) * Number(l.unitCost)} currency={currency} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(tr.notes || tr.receptionNotes) && (
          <div className="border-t border-gray-100 p-4 text-sm text-gray-600 space-y-1">
            {tr.notes && <p>Note d&apos;expédition : {tr.notes}</p>}
            {tr.receptionNotes && <p>Note de réception : {tr.receptionNotes}</p>}
          </div>
        )}
        {receiving && (
          <div className="border-t border-gray-100 p-4 space-y-3">
            <Field label="Note de réception (facultatif)" hint="Ex. « 2 cartons abîmés refusés »">
              <Textarea rows={2} value={receptionNotes} onChange={(e) => setReceptionNotes(e.target.value)} maxLength={500} />
            </Field>
            <div className="flex justify-end">
              <Button variant="success" onClick={receive} loading={busy}>
                Réceptionner la marchandise
              </Button>
            </div>
          </div>
        )}
      </Card>

      {cancelling && (
        <CancelTransferModal
          id={tr.id}
          from={tr.fromCenter.name}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            setNotice(`Transfert annulé : la marchandise est revenue dans le stock de ${tr.fromCenter.name}.`);
            void load();
          }}
        />
      )}
    </>
  );
}

function CancelTransferModal({ id, from, onClose, onDone }: { id: string; from: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/transfers/${id}/cancel`, { reason });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Annuler le transfert"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Retour
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 3}>
            Annuler le transfert
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-gray-700">La marchandise est remise dans le stock de {from} (mêmes lots, même coût).</p>
      <Field label="Motif">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
      </Field>
    </Modal>
  );
}
