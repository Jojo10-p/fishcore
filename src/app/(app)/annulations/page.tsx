"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, Money, PageHeader, Select, Spinner, Table, Td, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface CancellationRow {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestReason: string;
  rejectionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  sale: { id: string; saleNumber: string; totalAmount: string; createdAt: string; centerId: string; sessionId: string };
  requester: { id: string; firstName: string; lastName: string };
  approver: { firstName: string; lastName: string } | null;
}

const STATUS = {
  PENDING: { label: "En attente", tone: "amber" as const },
  APPROVED: { label: "Approuvée", tone: "green" as const },
  REJECTED: { label: "Refusée", tone: "red" as const },
};

export default function CancellationsPage() {
  const { centerId, currency, can, session } = useSession();
  const canDecide = can("sale:cancel_approve");
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED" | "">("PENDING");
  const [rows, setRows] = useState<CancellationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ row: CancellationRow; decision: "APPROVED" | "REJECTED" } | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (centerId) params.set("centerId", centerId);
    try {
      const res = await apiGet<{ data: CancellationRow[] }>(`/api/cancellations?${params}`);
      setRows(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [status, centerId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <PageHeader
        title="Annulations"
        description={canDecide ? "Demandes à examiner. Vous ne pouvez pas décider de vos propres demandes." : "Vos demandes d'annulation."}
        actions={
          <Select aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-auto">
            <option value="PENDING">En attente</option>
            <option value="APPROVED">Approuvées</option>
            <option value="REJECTED">Refusées</option>
            <option value="">Toutes</option>
          </Select>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon="✅" title="Aucune demande" />
        ) : (
          <Table head={["Vente", "Montant", "Demandée par", "Motif", "Statut", ""]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link href={`/recu/${r.sale.id}`} target="_blank" className="text-blue-600 hover:underline">
                    {r.sale.saleNumber}
                  </Link>
                  <p className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString("fr-FR")}</p>
                </Td>
                <Td>
                  <Money value={r.sale.totalAmount} currency={currency} />
                </Td>
                <Td>
                  {r.requester.firstName} {r.requester.lastName}
                </Td>
                <Td className="whitespace-normal max-w-xs">
                  {r.requestReason}
                  {r.rejectionReason && <p className="text-xs text-red-700 mt-1">Refus : {r.rejectionReason}</p>}
                </Td>
                <Td>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  {r.approver && <p className="text-xs text-gray-500 mt-1">par {r.approver.firstName}</p>}
                </Td>
                <Td>
                  {r.status === "PENDING" && canDecide && r.requester.id !== session?.user.id && (
                    <div className="flex gap-2">
                      <Button variant="success" className="px-3 py-1.5" onClick={() => setDeciding({ row: r, decision: "APPROVED" })}>
                        Approuver
                      </Button>
                      <Button variant="secondary" className="px-3 py-1.5" onClick={() => setDeciding({ row: r, decision: "REJECTED" })}>
                        Refuser
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <DecisionModal state={deciding} currency={currency} onClose={() => setDeciding(null)} onDone={load} />
    </>
  );
}

function DecisionModal({
  state,
  currency,
  onClose,
  onDone,
}: {
  state: { row: CancellationRow; decision: "APPROVED" | "REJECTED" } | null;
  currency: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [refundSessionId, setRefundSessionId] = useState("");
  const [sessions, setSessions] = useState<Array<{ id: string; cashRegister: { name: string }; cashier: { firstName: string } }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Caisses ouvertes du centre : celle qui rend l'argent au client
  useEffect(() => {
    if (state?.decision !== "APPROVED") return;
    apiGet<{ data: Array<{ id: string; cashRegister: { name: string }; cashier: { firstName: string } }> }>(
      `/api/cash/sessions?open=true&centerId=${state.row.sale.centerId}`
    )
      .then((r) => {
        setSessions(r.data);
        setRefundSessionId(r.data.find((s) => s.id === state.row.sale.sessionId)?.id ?? r.data[0]?.id ?? "");
      })
      .catch(() => setSessions([]));
  }, [state]);

  if (!state) return null;
  const approve = state.decision === "APPROVED";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/sales/${state.row.sale.id}/cancel`, {
        action: "decide",
        cancellationId: state.row.id,
        decision: state.decision,
        rejectionReason: approve ? undefined : reason,
        refundSessionId: approve && refundSessionId ? refundSessionId : undefined,
      });
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
      open
      onClose={onClose}
      title={`${approve ? "Approuver" : "Refuser"} l'annulation de ${state.row.sale.saleNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button variant={approve ? "success" : "danger"} onClick={submit} loading={busy} disabled={!approve && reason.trim().length < 3}>
            Confirmer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {approve ? (
        <>
          <Alert tone="amber">
            Le stock sera remis et <Money value={state.row.sale.totalAmount} currency={currency} /> seront enregistrés comme remboursés. Cette action est
            définitive et historisée.
          </Alert>
          <Field label="Caisse qui rend l'argent" hint="Le remboursement sera déduit du solde de cette caisse à sa clôture.">
            <Select value={refundSessionId} onChange={(e) => setRefundSessionId(e.target.value)}>
              <option value="">Hors caisse (ex. mobile money rendu à distance)</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.cashRegister.name} — {s.cashier.firstName}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : (
        <Field label="Motif du refus">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}
