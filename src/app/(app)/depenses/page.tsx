"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { DrawerSelect } from "@/components/app/drawer-select";
import { PAYMENT_METHOD_LABELS, PeriodPicker, presetPeriod, type Period } from "@/components/app/period-picker";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Select, Spinner, Table, Td, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { formatCurrency, currencyLabel } from "@/lib/utils";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";

interface Expense {
  id: string;
  date: string;
  category: string;
  amount: string;
  description: string | null;
  payee: string | null;
  method: string;
  reference: string | null;
  sessionId: string | null;
  isCancelled: boolean;
  cancelReason: string | null;
  center: { name: string };
}

// Dépenses (cahier §14) : classées par catégorie, rattachées à un centre,
// éventuellement sorties d'une caisse. Annulables, jamais supprimées.
export default function ExpensesPage() {
  const { centerId, can, currency } = useSession();
  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Expense | null>(null);

  const load = useCallback(async () => {
    if (!centerId) return;
    try {
      const from = new Date(`${period.from}T00:00:00`).toISOString();
      const to = new Date(`${period.to}T23:59:59.999`).toISOString();
      const r = await apiGet<{ data: Expense[] }>(`/api/expenses?centerId=${centerId}&from=${from}&to=${to}`);
      setExpenses(r.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [centerId, period]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const total = expenses?.filter((e) => !e.isCancelled).reduce((s, e) => s + Number(e.amount), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Dépenses"
        description={expenses ? `Total de la période : ${formatCurrency(total, currency)} (hors annulations)` : undefined}
        actions={can("expense:create") && <Button onClick={() => setCreating(true)}>Nouvelle dépense</Button>}
      />
      <Card className="p-3 sm:p-4 mb-4">
        <PeriodPicker value={period} onChange={setPeriod} />
      </Card>
      {error && <Alert>{error}</Alert>}
      <Card>
        {!expenses ? (
          <Spinner />
        ) : expenses.length === 0 ? (
          <EmptyState icon="💸" title="Aucune dépense sur la période" />
        ) : (
          <Table head={["Date", "Catégorie", "Détail", "Paiement", "Montant", ""]}>
            {expenses.map((e) => (
              <tr key={e.id} className={e.isCancelled ? "opacity-60" : ""}>
                <Td>{new Date(e.date).toLocaleDateString("fr-FR")}</Td>
                <Td>{e.category}</Td>
                <Td className="whitespace-normal max-w-xs">
                  {e.description}
                  {e.payee && <span className="block text-xs text-gray-500">À : {e.payee}</span>}
                  {e.isCancelled && <span className="block text-xs text-red-700">Annulée : {e.cancelReason}</span>}
                </Td>
                <Td>
                  {PAYMENT_METHOD_LABELS[e.method] ?? e.method}
                  {e.sessionId && <span className="block text-xs text-gray-500">sortie de caisse</span>}
                  {e.reference && <span className="block text-xs text-gray-500">{e.reference}</span>}
                </Td>
                <Td className={e.isCancelled ? "line-through" : "font-semibold"}>
                  <Money value={e.amount} currency={currency} />
                </Td>
                <Td>
                  {e.isCancelled ? (
                    <Badge tone="red">Annulée</Badge>
                  ) : (
                    can("expense:cancel") && (
                      <button className="text-sm text-red-600 hover:underline" onClick={() => setCancelling(e)}>
                        Annuler
                      </button>
                    )
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && centerId && <ExpenseModal centerId={centerId} currency={currency} onClose={() => setCreating(false)} onSaved={load} />}
      {cancelling && <CancelModal expense={cancelling} currency={currency} onClose={() => setCancelling(null)} onDone={load} />}
    </>
  );
}

function ExpenseModal({ centerId, currency, onClose, onSaved }: { centerId: string; currency: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    category: EXPENSE_CATEGORIES[0] as string,
    otherCategory: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    description: "",
    payee: "",
    method: "CASH",
    reference: "",
    sessionId: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/expenses", {
        centerId,
        category: form.category === "__other" ? form.otherCategory : form.category,
        amount: Number(form.amount.replace(",", ".")),
        date: form.date,
        description: form.description || undefined,
        payee: form.payee || undefined,
        method: form.method,
        reference: form.reference || undefined,
        sessionId: form.method === "CASH" && form.sessionId ? form.sessionId : undefined,
      });
      await onSaved();
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
      title="Nouvelle dépense"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy} disabled={!form.amount || Number(form.amount) <= 0 || (form.category === "__other" && form.otherCategory.trim().length < 2)}>
            Enregistrer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Catégorie">
          <Select value={form.category} onChange={set("category")}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__other">Autre…</option>
          </Select>
        </Field>
        <Field label={`Montant (${currencyLabel(currency)})`}>
          <Input inputMode="decimal" value={form.amount} onChange={set("amount")} autoFocus />
        </Field>
      </div>
      {form.category === "__other" && (
        <Field label="Nom de la catégorie">
          <Input value={form.otherCategory} onChange={set("otherCategory")} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={set("date")} />
        </Field>
        <Field label="Bénéficiaire">
          <Input value={form.payee} onChange={set("payee")} placeholder="ex. SBEE" />
        </Field>
      </div>
      <Field label="Description">
        <Textarea rows={2} value={form.description} onChange={set("description")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Moyen de paiement">
          <Select value={form.method} onChange={set("method")}>
            {["CASH", "MOBILE_MONEY", "CARD", "TRANSFER"].map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Référence (facture, transaction)">
          <Input value={form.reference} onChange={set("reference")} />
        </Field>
      </div>
      {form.method === "CASH" && <DrawerSelect centerId={centerId} direction="out" value={form.sessionId} onChange={(v) => setForm((f) => ({ ...f, sessionId: v }))} />}
    </Modal>
  );
}

function CancelModal({ expense, currency, onClose, onDone }: { expense: Expense; currency: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/expenses/${expense.id}/cancel`, { reason });
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
      title="Annuler la dépense"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 3}>
            Annuler la dépense
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-gray-600">
        {expense.category} — <Money value={expense.amount} currency={currency} />. La dépense reste visible (barrée) dans l&apos;historique.
        {expense.sessionId && " Si la caisse est encore ouverte, le montant y est remis."}
      </p>
      <Field label="Motif">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}
