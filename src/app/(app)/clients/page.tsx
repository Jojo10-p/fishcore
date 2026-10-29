"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { DrawerSelect } from "@/components/app/drawer-select";
import { PAYMENT_METHOD_LABELS } from "@/components/app/period-picker";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { generateIdempotencyKey, formatCurrency, currencyLabel } from "@/lib/utils";

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: string | null;
  balance: string;
  lastCreditAt: string | null;
}
interface Statement {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  creditLimit: string | null;
  balance: string;
  statement: Array<{ date: string; kind: "SALE" | "REFUND" | "PAYMENT"; label: string; saleId: string | null; debit: number; credit: number; balance: number }>;
}

// Clients et créances (cahier §14) : qui doit combien, depuis quand, et encaissement des règlements
export default function CustomersPage() {
  const { can, currency } = useSession();
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [onlyDebtors, setOnlyDebtors] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ data: CustomerRow[] }>(`/api/customers?withBalance=true${search ? `&search=${encodeURIComponent(search)}` : ""}`);
      setCustomers(r.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const visible = customers?.filter((c) => !onlyDebtors || Number(c.balance) > 0) ?? null;
  const totalDue = customers?.reduce((s, c) => s + Math.max(0, Number(c.balance)), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Clients & créances"
        description={customers ? `Total à encaisser : ${formatCurrency(totalDue, currency)}` : undefined}
        actions={<Button onClick={() => setCreating(true)}>Nouveau client</Button>}
      />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input placeholder="Rechercher (nom, téléphone)" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={onlyDebtors} onChange={(e) => setOnlyDebtors(e.target.checked)} />
          Seulement les clients qui doivent de l&apos;argent
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card>
        {!visible ? (
          <Spinner />
        ) : visible.length === 0 ? (
          <EmptyState icon="👤" title={onlyDebtors ? "Aucune créance en cours" : "Aucun client"} />
        ) : (
          <Table head={["Client", "Téléphone", "Doit", "Plafond", "Dernier crédit", ""]}>
            {visible.map((c) => {
              const balance = Number(c.balance);
              const limit = c.creditLimit !== null ? Number(c.creditLimit) : null;
              return (
                <tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.phone ?? "—"}</Td>
                  <Td className={balance > 0 ? "font-semibold" : "text-gray-500"}>
                    <Money value={balance} currency={currency} />
                    {limit !== null && balance >= limit && <span className="ml-2"><Badge tone="red">plafond atteint</Badge></span>}
                    {balance < 0 && <span className="ml-2"><Badge tone="blue">avoir</Badge></span>}
                  </Td>
                  <Td>{limit !== null ? <Money value={limit} currency={currency} /> : <span className="text-gray-400">aucun</span>}</Td>
                  <Td>{c.lastCreditAt ? new Date(c.lastCreditAt).toLocaleDateString("fr-FR") : "—"}</Td>
                  <Td>
                    <button className="text-sm text-blue-600 hover:underline" onClick={() => setSelected(c.id)}>
                      Relevé{can("customer:payment") && balance > 0 ? " / encaisser" : ""}
                    </button>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {selected && <CustomerModal id={selected} currency={currency} onClose={() => setSelected(null)} onChanged={load} />}
      {creating && <CreateCustomerModal currency={currency} onClose={() => setCreating(false)} onCreated={load} />}
    </>
  );
}

function CustomerModal({ id, currency, onClose, onChanged }: { id: string; currency: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const { can, centerId } = useSession();
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pay, setPay] = useState({ amount: "", method: "CASH", reference: "", sessionId: "" });
  const [limit, setLimit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ data: Statement }>(`/api/customers/${id}`);
      setData(r.data);
      setLimit(r.data.creditLimit !== null ? String(Number(r.data.creditLimit)) : "");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const receive = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/customers/${id}/payments`, {
        amount: Number(pay.amount.replace(",", ".")),
        method: pay.method,
        reference: pay.reference || undefined,
        sessionId: pay.method === "CASH" && pay.sessionId ? pay.sessionId : undefined,
        idempotencyKey: generateIdempotencyKey("cpay"),
      });
      setDone(`Règlement de ${formatCurrency(Number(pay.amount.replace(",", ".")), currency)} enregistré.`);
      setPay((p) => ({ ...p, amount: "", reference: "" }));
      await load();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveLimit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/customers/${id}`, { creditLimit: limit === "" ? null : Number(limit) }, "PATCH");
      setDone("Plafond de crédit mis à jour.");
      await load();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const balance = Number(data?.balance ?? 0);

  return (
    <Modal open onClose={onClose} title={data ? `Relevé — ${data.name}` : "Relevé client"}>
      {error && <Alert>{error}</Alert>}
      {done && <Alert tone="green">{done}</Alert>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-gray-600">{data.phone}</span>
            <span className="text-lg font-bold">
              Doit : <Money value={balance} currency={currency} />
            </span>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-2 py-1.5">Date</th>
                  <th className="text-left px-2 py-1.5">Opération</th>
                  <th className="text-right px-2 py-1.5">Débit</th>
                  <th className="text-right px-2 py-1.5">Crédit</th>
                  <th className="text-right px-2 py-1.5">Solde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.statement.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-center text-gray-400">
                      Aucune opération à crédit
                    </td>
                  </tr>
                )}
                {data.statement.map((e, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{new Date(e.date).toLocaleDateString("fr-FR")}</td>
                    <td className="px-2 py-1.5">
                      {e.saleId ? (
                        <Link href={`/recu/${e.saleId}`} target="_blank" className="text-blue-600 hover:underline">
                          {e.label}
                        </Link>
                      ) : (
                        e.label
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{e.debit ? e.debit.toLocaleString("fr-FR") : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{e.credit ? e.credit.toLocaleString("fr-FR") : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{e.balance.toLocaleString("fr-FR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {can("customer:payment") && balance > 0 && (
            <fieldset className="space-y-3 rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-sm font-medium text-gray-700">Encaisser un règlement</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Montant (${currencyLabel(currency)})`}>
                  <Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} placeholder={String(balance)} />
                </Field>
                <Field label="Moyen">
                  <Select value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}>
                    {["CASH", "MOBILE_MONEY", "TRANSFER", "CARD"].map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {pay.method !== "CASH" && (
                <Field label="Référence de transaction">
                  <Input value={pay.reference} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} />
                </Field>
              )}
              {pay.method === "CASH" && <DrawerSelect centerId={centerId} direction="in" value={pay.sessionId} onChange={(v) => setPay((p) => ({ ...p, sessionId: v }))} />}
              <Button onClick={receive} loading={busy} disabled={!pay.amount || Number(pay.amount) <= 0 || Number(pay.amount) > balance}>
                Enregistrer le règlement
              </Button>
            </fieldset>
          )}

          {can("customer:edit") && (
            <div className="flex items-end gap-2">
              <Field label={`Plafond de crédit (${currencyLabel(currency)})`} hint="Vide = pas de plafond. Une vente à crédit au-delà sera refusée.">
                <Input inputMode="numeric" value={limit ?? ""} onChange={(e) => setLimit(e.target.value)} />
              </Field>
              <Button variant="secondary" onClick={saveLimit} loading={busy}>
                Enregistrer
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function CreateCustomerModal({ currency, onClose, onCreated }: { currency: string; onClose: () => void; onCreated: () => Promise<void> }) {
  const { can } = useSession();
  const [form, setForm] = useState({ name: "", phone: "", address: "", creditLimit: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      await apiSend("/api/customers", {
        name: form.name,
        phone: form.phone || undefined,
        address: form.address || undefined,
        ...(form.creditLimit ? { creditLimit: Number(form.creditLimit) } : {}),
      });
      await onCreated();
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
      title="Nouveau client"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy} disabled={form.name.trim().length < 2}>
            Créer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Nom / raison sociale">
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Téléphone">
          <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </Field>
        {can("customer:edit") && (
          <Field label={`Plafond de crédit (${currencyLabel(currency)})`}>
            <Input inputMode="numeric" value={form.creditLimit} onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))} placeholder="aucun" />
          </Field>
        )}
      </div>
      <Field label="Adresse">
        <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
      </Field>
    </Modal>
  );
}
