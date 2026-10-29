"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  salesCount: number;
  salesTotal: string;
  lastPurchaseAt: string | null;
}
interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  sales: Array<{ id: string; saleNumber: string; createdAt: string; totalAmount: string; status: string; deliveryStatus: string }>;
  quotes: Array<{ id: string; number: string; createdAt: string; totalAmount: string; status: string; validUntil: string }>;
}

// Clients (cahier §13) : fiche (pour les factures et devis à leur nom) et historique d'achats
export default function CustomersPage() {
  const { can, currency } = useSession();
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ data: CustomerRow[] }>(`/api/customers?withStats=true${search ? `&search=${encodeURIComponent(search)}` : ""}`);
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

  return (
    <>
      <PageHeader
        title="Clients"
        description="Les factures et devis sont établis au nom du client choisi à la caisse ou sur le devis."
        actions={can("customer:edit") && <Button onClick={() => setCreating(true)}>Nouveau client</Button>}
      />
      <Input placeholder="Rechercher (nom, téléphone, IFU)" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 sm:max-w-sm" />
      {error && <Alert>{error}</Alert>}
      <Card>
        {!customers ? (
          <Spinner />
        ) : customers.length === 0 ? (
          <EmptyState icon="👤" title="Aucun client" />
        ) : (
          <Table head={["Client", "Téléphone", "Achats", "Total acheté", "Dernier achat", ""]}>
            {customers.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">
                  {c.name}
                  {c.taxId && <span className="block text-xs font-normal text-gray-500">IFU {c.taxId}</span>}
                </Td>
                <Td>{c.phone ?? "—"}</Td>
                <Td>{c.salesCount}</Td>
                <Td>
                  <Money value={c.salesTotal} currency={currency} />
                </Td>
                <Td>{c.lastPurchaseAt ? new Date(c.lastPurchaseAt).toLocaleDateString("fr-FR") : "—"}</Td>
                <Td>
                  <button className="text-sm text-blue-600 hover:underline" onClick={() => setSelected(c.id)}>
                    Fiche
                  </button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {selected && <CustomerModal id={selected} currency={currency} onClose={() => setSelected(null)} onChanged={load} />}
      {creating && <CustomerForm onClose={() => setCreating(false)} onSaved={load} />}
    </>
  );
}

const SALE_STATUS: Record<string, { label: string; tone: "green" | "red" | "amber" | "gray" }> = {
  COMPLETED: { label: "Payée", tone: "green" },
  CANCELLED: { label: "Annulée", tone: "red" },
  PARTIALLY_REFUNDED: { label: "Remboursée en partie", tone: "amber" },
  FULLY_REFUNDED: { label: "Remboursée", tone: "red" },
};

function CustomerModal({ id, currency, onClose, onChanged }: { id: string; currency: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const { can } = useSession();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData((await apiGet<{ data: CustomerDetail }>(`/api/customers/${id}`)).data);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (editing && data) {
    return (
      <CustomerForm
        initial={data}
        onClose={() => setEditing(false)}
        onSaved={async () => {
          await load();
          await onChanged();
        }}
      />
    );
  }

  return (
    <Modal open onClose={onClose} size="lg" title={data ? data.name : "Client"}>
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 text-sm">
            <div className="space-y-0.5 text-gray-700">
              {data.phone && <p>Tél. {data.phone}</p>}
              {data.email && <p>{data.email}</p>}
              {data.address && <p>{data.address}</p>}
              {data.taxId && <p>IFU : {data.taxId}</p>}
            </div>
            {can("customer:edit") && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Modifier
              </Button>
            )}
          </div>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-gray-800">Factures ({data.sales.length})</h3>
            {data.sales.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun achat à son nom.</p>
            ) : (
              <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100 text-sm">
                {data.sales.map((s) => {
                  const st = SALE_STATUS[s.status] ?? { label: s.status, tone: "gray" as const };
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span>
                        <Link href={`/facture/${s.id}`} target="_blank" className="font-medium text-blue-600 hover:underline">
                          {s.saleNumber}
                        </Link>
                        <span className="ml-2 text-xs text-gray-500">{new Date(s.createdAt).toLocaleDateString("fr-FR")}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <Money value={s.totalAmount} currency={currency} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-gray-800">Devis ({data.quotes.length})</h3>
            {data.quotes.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun devis.</p>
            ) : (
              <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100 text-sm">
                {data.quotes.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span>
                      <Link href={`/devis/${q.id}`} target="_blank" className="font-medium text-blue-600 hover:underline">
                        {q.number}
                      </Link>
                      <span className="ml-2 text-xs text-gray-500">{new Date(q.createdAt).toLocaleDateString("fr-FR")}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={q.status === "CONVERTED" ? "green" : q.status === "CANCELLED" ? "red" : "blue"}>
                        {q.status === "CONVERTED" ? "Encaissé" : q.status === "CANCELLED" ? "Annulé" : "Ouvert"}
                      </Badge>
                      <Money value={q.totalAmount} currency={currency} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Modal>
  );
}

function CustomerForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: { id: string; name: string; phone: string | null; email: string | null; address: string | null; taxId: string | null };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    address: initial?.address ?? "",
    taxId: initial?.taxId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (initial) await apiSend(`/api/customers/${initial.id}`, form, "PATCH");
      else await apiSend("/api/customers", { ...form, phone: form.phone || undefined, address: form.address || undefined, taxId: form.taxId || undefined });
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
      title={initial ? `Modifier — ${initial.name}` : "Nouveau client"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy} disabled={form.name.trim().length < 2}>
            Enregistrer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Nom / raison sociale">
        <Input value={form.name} onChange={set("name")} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Téléphone">
          <Input value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="IFU" hint="Pour une facture à une entreprise">
          <Input value={form.taxId} onChange={set("taxId")} />
        </Field>
      </div>
      <Field label="Email">
        <Input type="email" value={form.email} onChange={set("email")} />
      </Field>
      <Field label="Adresse">
        <Input value={form.address} onChange={set("address")} />
      </Field>
    </Modal>
  );
}
