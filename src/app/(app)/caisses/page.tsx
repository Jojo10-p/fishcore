"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { CashJournal, PrintableJournal, printJournal, type CloseResult } from "@/components/pos/cash-journal";

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
  validatedBy?: string | null;
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
  const [day, setDay] = useState("");
  const [more, setMore] = useState(true);
  // Journal de caisse ouvert (aussi depuis une notification : ?journal=<id>)
  const [journalId, setJournalId] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("journal") : null
  );

  const load = useCallback(async () => {
    if (!centerId) return;
    try {
      const [r, s] = await Promise.all([
        apiGet<{ data: Register[] }>(`/api/cash/registers?centerId=${centerId}`),
        apiGet<{ data: SessionRow[] }>(`/api/cash/sessions?centerId=${centerId}${day ? `&day=${day}` : ""}`),
      ]);
      setRegisters(r.data);
      setSessions(s.data);
      setMore(!day && s.data.length >= 50);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [centerId, day]);

  const loadMore = async () => {
    const last = sessions?.at(-1);
    if (!last || !centerId) return;
    try {
      const s = await apiGet<{ data: SessionRow[] }>(`/api/cash/sessions?centerId=${centerId}&before=${encodeURIComponent(last.openedAt)}`);
      setSessions((list) => [...(list ?? []), ...s.data]);
      setMore(s.data.length >= 50);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // « Oui, c'est bon » : le gérant ou la direction, jamais celui qui a tenu la caisse
  // (sauf la direction, qui n'a personne au-dessus d'elle)
  const canValidate = (cashierId?: string) =>
    can("cash:close_session_validate") && (cashierId !== session?.user.id || session?.user.role === "COMPANY_OWNER");

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
        description="Quand une caisse est clôturée, le gérant ou la direction ouvre le journal, vérifie et valide : « Oui, c'est bon »."
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Journaux de caisse</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Jour
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-auto" />
            {day && (
              <button className="text-blue-600 hover:underline" onClick={() => setDay("")}>
                Tout
              </button>
            )}
          </label>
        </div>
        {!sessions ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <EmptyState icon="💰" title="Aucune session" />
        ) : (
          <Table head={["Caisse", "Caissier", "Ouverture", "Clôture", "Encaissé", "Théorique", "Compté", "Écart", "Statut", ""]}>
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
                      <div>
                        <Badge tone="green">Clôturée · validée ✅</Badge>
                        {s.validatedBy && <p className="mt-0.5 text-xs text-gray-500">par {s.validatedBy}</p>}
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone="amber">Clôturée · à valider</Badge>
                        {canValidate(s.cashierId) && (
                          <button className="text-xs font-semibold text-green-700 hover:underline" onClick={() => setJournalId(s.id)}>
                            Vérifier et valider →
                          </button>
                        )}
                      </div>
                    )}
                  </Td>
                  <Td>
                    {s.closedAt && (
                      <button className="text-sm font-semibold text-blue-700 hover:underline" onClick={() => setJournalId(s.id)}>
                        Journal
                      </button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        {more && sessions && sessions.length > 0 && (
          <button className="w-full border-t border-gray-100 py-3 text-sm text-blue-600 hover:bg-gray-50" onClick={() => void loadMore()}>
            Voir les plus anciennes
          </button>
        )}
      </Card>

      {journalId && (
        <JournalModal
          sessionId={journalId}
          currency={currency}
          canValidate={canValidate}
          busy={busyId === journalId}
          onValidate={async () => {
            await validate(journalId);
          }}
          onClose={() => setJournalId(null)}
        />
      )}

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

/** Journal d'une caisse fermée, à revoir et réimprimer à tout moment. */
function JournalModal({
  sessionId,
  currency,
  canValidate,
  busy,
  onValidate,
  onClose,
}: {
  sessionId: string;
  currency: string;
  canValidate: (cashierId?: string) => boolean;
  busy: boolean;
  onValidate: () => Promise<void>;
  onClose: () => void;
}) {
  const [r, setR] = useState<CloseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      apiGet<{ data: CloseResult }>(`/api/cash/sessions/${sessionId}/journal`)
        .then((res) => setR(res.data))
        .catch((e) => setError(errorMessage(e))),
    [sessionId]
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  const gap = r ? Number(r.discrepancy) : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Journal de caisse"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button onClick={() => r && printJournal(r)} disabled={!r}>
            🖨 Imprimer / enregistrer en PDF
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {!r && !error && <Spinner />}
      {r && (
        <>
          {r.isValidated ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <p className="font-semibold">✅ Caisse clôturée et validée</p>
              {r.validatedBy && <p>Vérifiée par {r.validatedBy}.</p>}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">🔒 Caisse clôturée — en attente de validation</p>
              {canValidate(r.cashierId) ? (
                <>
                  <p className="mt-1">
                    Vérifiez le journal ci-dessous{gap !== 0 ? " (attention : il y a un écart)" : ""}. Si tout est juste, validez.
                  </p>
                  <Button
                    variant="success"
                    className="mt-2 w-full"
                    loading={busy}
                    onClick={async () => {
                      await onValidate();
                      await reload();
                    }}
                  >
                    ✅ Oui, c&apos;est bon — valider la clôture
                  </Button>
                </>
              ) : (
                <p className="mt-1">Le gérant ou la direction doit vérifier et valider.</p>
              )}
            </div>
          )}
          <CashJournal r={r} currency={currency} />
          <PrintableJournal r={r} currency={currency} />
        </>
      )}
    </Modal>
  );
}
