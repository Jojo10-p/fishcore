"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface Register {
  id: string;
  name: string;
  state: string;
  openSession: { id: string; openedAt: string; cashier: { firstName: string; lastName: string } } | null;
}
interface SessionRow {
  id: string;
  openedAt: string;
  closedAt: string | null;
  isValidated: boolean;
  cashierId: string;
  openingBalance: string;
  theoreticalBalance: string | null;
  closingBalance: string | null;
  discrepancy: string | null;
  cashier: { firstName: string; lastName: string };
  cashRegister: { name: string };
  closure: { totalSales: string; totalCash: string; totalMobileMoney: string; totalRefunds: string; totalCashOut: string } | null;
}

export default function CaissesPage() {
  const { centerId, currency, can, session } = useSession();
  const [registers, setRegisters] = useState<Register[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRegister, setNewRegister] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!centerId) return;
    try {
      const [r, s] = await Promise.all([
        apiGet<{ data: Register[] }>(`/api/cash/registers?centerId=${centerId}`),
        apiGet<{ data: SessionRow[] }>(`/api/cash/sessions?centerId=${centerId}`),
      ]);
      setRegisters(r.data);
      setSessions(s.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [centerId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const validate = async (id: string) => {
    setBusyId(id);
    try {
      await apiSend("/api/cash/sessions", { action: "validate", sessionId: id });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const createRegister = async () => {
    if (!newRegister?.trim() || !centerId) return;
    try {
      await apiSend("/api/cash/registers", { centerId, name: newRegister.trim() });
      setNewRegister(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Caisses & clôtures"
        description="Une clôture est validée par une autre personne que le caissier."
        actions={can("cash:register_manage") && <Button variant="secondary" onClick={() => setNewRegister("")}>Ajouter une caisse</Button>}
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {!registers ? (
          <Spinner />
        ) : (
          registers.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-900">{r.name}</p>
                {r.openSession ? <Badge tone="green">Ouverte</Badge> : <Badge>Fermée</Badge>}
              </div>
              {r.openSession && (
                <p className="text-sm text-gray-500 mt-1">
                  {r.openSession.cashier.firstName} {r.openSession.cashier.lastName} depuis{" "}
                  {new Date(r.openSession.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </Card>
          ))
        )}
      </div>

      <Card>
        <h2 className="font-semibold text-gray-900 px-4 sm:px-6 py-4 border-b border-gray-100">Sessions récentes</h2>
        {!sessions ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <EmptyState icon="💰" title="Aucune session" />
        ) : (
          <Table head={["Caisse", "Caissier", "Ouverture", "Clôture", "Encaissé", "Théorique", "Compté", "Écart", "Statut"]}>
            {sessions.map((s) => {
              const gap = s.discrepancy !== null ? Number(s.discrepancy) : null;
              return (
                <tr key={s.id}>
                  <Td>{s.cashRegister.name}</Td>
                  <Td>
                    {s.cashier.firstName} {s.cashier.lastName}
                  </Td>
                  <Td>{new Date(s.openedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</Td>
                  <Td>{s.closedAt ? new Date(s.closedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—"}</Td>
                  <Td>{s.closure ? <Money value={s.closure.totalSales} currency={currency} /> : "—"}</Td>
                  <Td>{s.theoreticalBalance !== null ? <Money value={s.theoreticalBalance} currency={currency} /> : "—"}</Td>
                  <Td>{s.closingBalance !== null ? <Money value={s.closingBalance} currency={currency} /> : "—"}</Td>
                  <Td className={gap === null ? "" : gap === 0 ? "text-green-700" : "text-red-700 font-semibold"}>
                    {gap === null ? "—" : <Money value={gap} currency={currency} />}
                  </Td>
                  <Td>
                    {!s.closedAt ? (
                      <Badge tone="blue">En cours</Badge>
                    ) : s.isValidated ? (
                      <Badge tone="green">Validée</Badge>
                    ) : can("cash:close_session_validate") && s.cashierId !== session?.user.id ? (
                      <Button variant="success" className="px-3 py-1.5" loading={busyId === s.id} onClick={() => validate(s.id)}>
                        Valider
                      </Button>
                    ) : (
                      <Badge tone="amber">À valider</Badge>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Modal
        open={newRegister !== null}
        onClose={() => setNewRegister(null)}
        title="Nouvelle caisse"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewRegister(null)}>
              Annuler
            </Button>
            <Button onClick={createRegister} disabled={!newRegister?.trim()}>
              Créer
            </Button>
          </>
        }
      >
        <Field label="Nom de la caisse">
          <Input value={newRegister ?? ""} onChange={(e) => setNewRegister(e.target.value)} placeholder="Caisse 2" autoFocus />
        </Field>
      </Modal>
    </>
  );
}
