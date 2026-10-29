"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { DrawerSelect } from "@/components/app/drawer-select";
import { PAYMENT_METHOD_LABELS } from "@/components/app/period-picker";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { formatCurrency, currencyLabel } from "@/lib/utils";

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  paymentTermDays: number;
  debt: string;
  overdue: string;
  nextDue: string | null;
}
interface SupplierDetail {
  id: string;
  name: string;
  debt: number;
  purchases: Array<{
    id: string;
    reference: string | null;
    totalAmount: string;
    paidAmount: string;
    dueDate: string | null;
    createdAt: string;
    center: { name: string };
  }>;
  payments: Array<{ id: string; amount: string; method: string; reference: string | null; createdAt: string }>;
}

// Fournisseurs et dettes (cahier §12) : factures, échéances, paiements
export default function SuppliersPage() {
  const { can, currency } = useSession();
  const [rows, setRows] = useState<SupplierRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ data: SupplierRow[] }>("/api/suppliers");
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const totalDebt = rows?.reduce((s, r) => s + Number(r.debt), 0) ?? 0;
  const totalOverdue = rows?.reduce((s, r) => s + Number(r.overdue), 0) ?? 0;
  const [now] = useState(() => Date.now());

  return (
    <>
      <PageHeader
        title="Fournisseurs & dettes"
        description={rows ? `Dette totale : ${formatCurrency(totalDebt, currency)}${totalOverdue > 0 ? ` — dont échue : ${formatCurrency(totalOverdue, currency)}` : ""}` : undefined}
        actions={can("supplier:create") && <Button onClick={() => setCreating(true)}>Nouveau fournisseur</Button>}
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon="🏭" title="Aucun fournisseur" />
        ) : (
          <Table head={["Fournisseur", "Délai", "Dette", "Échue", "Prochaine échéance", ""]}>
            {rows.map((r) => {
              const debt = Number(r.debt);
              const overdue = Number(r.overdue);
              return (
                <tr key={r.id}>
                  <Td>
                    <p className="font-medium">{r.name}</p>
                    {r.phone && <p className="text-xs text-gray-500">{r.phone}</p>}
                  </Td>
                  <Td>{r.paymentTermDays ? `${r.paymentTermDays} j` : "comptant"}</Td>
                  <Td className={debt > 0 ? "font-semibold" : "text-gray-500"}>
                    <Money value={debt} currency={currency} />
                  </Td>
                  <Td>{overdue > 0 ? <Badge tone="red"><Money value={overdue} currency={currency} /></Badge> : "—"}</Td>
                  <Td>
                    {r.nextDue ? (
                      <span className={new Date(r.nextDue).getTime() < now ? "text-red-700" : ""}>{new Date(r.nextDue).toLocaleDateString("fr-FR")}</span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <button className="text-sm text-blue-600 hover:underline" onClick={() => setSelected(r.id)}>
                      Factures{can("supplier:payment") && debt > 0 ? " / payer" : ""}
                    </button>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {selected && <SupplierModal id={selected} currency={currency} now={now} onClose={() => setSelected(null)} onChanged={load} />}
      {creating && <CreateSupplierModal onClose={() => setCreating(false)} onCreated={load} />}
    </>
  );
}

function SupplierModal({ id, currency, now, onClose, onChanged }: { id: string; currency: string; now: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const { can, centerId } = useSession();
  const [data, setData] = useState<SupplierDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pay, setPay] = useState({ amount: "", method: "TRANSFER", reference: "", purchaseId: "", sessionId: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData((await apiGet<{ data: SupplierDetail }>(`/api/suppliers/${id}`)).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/suppliers/${id}/payments`, {
        amount: Number(pay.amount.replace(",", ".")),
        method: pay.method,
        reference: pay.reference || undefined,
        purchaseId: pay.purchaseId || undefined,
        sessionId: pay.method === "CASH" && pay.sessionId ? pay.sessionId : undefined,
      });
      setDone(`Paiement de ${formatCurrency(Number(pay.amount.replace(",", ".")), currency)} enregistré.`);
      setPay((p) => ({ ...p, amount: "", reference: "", purchaseId: "" }));
      await load();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const open = data?.purchases.filter((p) => Number(p.paidAmount) < Number(p.totalAmount)) ?? [];

  return (
    <Modal open onClose={onClose} title={data ? `Fournisseur — ${data.name}` : "Fournisseur"}>
      {error && <Alert>{error}</Alert>}
      {done && <Alert tone="green">{done}</Alert>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <p className="text-lg font-bold text-right">
            Dette : <Money value={data.debt} currency={currency} />
          </p>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-2 py-1.5">Facture</th>
                  <th className="text-left px-2 py-1.5">Échéance</th>
                  <th className="text-right px-2 py-1.5">Montant</th>
                  <th className="text-right px-2 py-1.5">Reste</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.purchases.map((p) => {
                  const left = Number(p.totalAmount) - Number(p.paidAmount);
                  const late = left > 0 && p.dueDate && new Date(p.dueDate).getTime() < now;
                  return (
                    <tr key={p.id}>
                      <td className="px-2 py-1.5">
                        {p.reference ?? "Sans référence"}
                        <span className="block text-gray-400">{new Date(p.createdAt).toLocaleDateString("fr-FR")} · {p.center.name}</span>
                      </td>
                      <td className={`px-2 py-1.5 ${late ? "text-red-700 font-medium" : ""}`}>
                        {p.dueDate ? new Date(p.dueDate).toLocaleDateString("fr-FR") : "—"}
                        {late && " (échue)"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{Number(p.totalAmount).toLocaleString("fr-FR")}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{left > 0 ? left.toLocaleString("fr-FR") : <Badge tone="green">soldée</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {can("supplier:payment") && data.debt > 0 && (
            <fieldset className="space-y-3 rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-sm font-medium text-gray-700">Payer le fournisseur</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Montant (${currencyLabel(currency)})`}>
                  <Input inputMode="decimal" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} />
                </Field>
                <Field label="Moyen">
                  <Select value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}>
                    {["TRANSFER", "MOBILE_MONEY", "CASH", "CARD"].map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Facture réglée" hint="Par défaut : la plus ancienne échéance d'abord.">
                <Select value={pay.purchaseId} onChange={(e) => setPay((p) => ({ ...p, purchaseId: e.target.value }))}>
                  <option value="">Plus ancienne d&apos;abord</option>
                  {open.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.reference ?? "Sans référence"} — reste {(Number(p.totalAmount) - Number(p.paidAmount)).toLocaleString("fr-FR")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Référence (virement, transaction…)">
                <Input value={pay.reference} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} />
              </Field>
              {pay.method === "CASH" && <DrawerSelect centerId={centerId} direction="out" value={pay.sessionId} onChange={(v) => setPay((p) => ({ ...p, sessionId: v }))} />}
              <Button onClick={submit} loading={busy} disabled={!pay.amount || Number(pay.amount) <= 0}>
                Enregistrer le paiement
              </Button>
            </fieldset>
          )}

          {data.payments.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-1">Paiements</h3>
              <ul className="text-xs divide-y divide-gray-100">
                {data.payments.map((p) => (
                  <li key={p.id} className="flex justify-between py-1">
                    <span>
                      {new Date(p.createdAt).toLocaleDateString("fr-FR")} — {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                      {p.reference && ` (${p.reference})`}
                    </span>
                    <Money value={p.amount} currency={currency} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function CreateSupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ name: "", phone: "", address: "", taxId: "", paymentTermDays: "0" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await apiSend("/api/suppliers", {
        name: form.name,
        phone: form.phone || undefined,
        address: form.address || undefined,
        taxId: form.taxId || undefined,
        paymentTermDays: Number(form.paymentTermDays || 0),
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
      title="Nouveau fournisseur"
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
      <Field label="Nom">
        <Input value={form.name} onChange={set("name")} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Téléphone">
          <Input value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="Délai de paiement (jours)" hint="0 = paiement comptant">
          <Input inputMode="numeric" value={form.paymentTermDays} onChange={set("paymentTermDays")} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Adresse">
          <Input value={form.address} onChange={set("address")} />
        </Field>
        <Field label="IFU">
          <Input value={form.taxId} onChange={set("taxId")} />
        </Field>
      </div>
    </Modal>
  );
}
