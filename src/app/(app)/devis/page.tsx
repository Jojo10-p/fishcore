"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { CustomerPicker, type PickedCustomer } from "@/components/app/customer-picker";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Select, Spinner, Table, Td, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { currencyLabel, formatCurrency } from "@/lib/utils";

interface QuoteRow {
  id: string;
  number: string;
  createdAt: string;
  validUntil: string;
  status: "OPEN" | "CONVERTED" | "CANCELLED";
  expired: boolean;
  totalAmount: string;
  customer: { id: string; name: string; phone: string | null };
  sale: { id: string; saleNumber: string } | null;
  _count: { lines: number };
}

interface Product {
  id: string;
  name: string;
  brand: string | null;
  sellingPrice: string;
  taxRate: string;
  baseUnitId: string;
  baseUnit: { symbol: string; allowsDecimal: boolean };
  unitConversions: Array<{ fromUnitId: string; factor: string; sellingPrice: string | null; fromUnit: { symbol: string; allowsDecimal: boolean } }>;
  stocks?: Array<{ quantity: string; reservedQty: string }>;
}

interface Line {
  key: string;
  productId: string;
  unitId: string;
  quantity: string;
  discount: string;
}

const STATUS: Record<string, { label: string; tone: "green" | "blue" | "red" | "gray" }> = {
  OPEN: { label: "Valable", tone: "blue" },
  CONVERTED: { label: "Encaissé", tone: "green" },
  CANCELLED: { label: "Annulé", tone: "red" },
  EXPIRED: { label: "Expiré", tone: "gray" },
};

// Devis (cahier §13) : établis ici, imprimés en A4, encaissés à la caisse
export default function QuotesPage() {
  const { can, currency } = useSession();
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<QuoteRow | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      const r = await apiGet<{ data: QuoteRow[] }>(`/api/quotes?${params}`);
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <>
      <PageHeader
        title="Devis"
        description="Établir un devis, l'imprimer pour le client, puis l'encaisser à la caisse en scannant son numéro."
        actions={can("quote:create") && <Button onClick={() => setCreating(true)}>Nouveau devis</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input placeholder="N° de devis ou client" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <Select aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
          <option value="">Tous les devis</option>
          <option value="OPEN">Valables</option>
          <option value="CONVERTED">Encaissés</option>
          <option value="EXPIRED">Expirés</option>
          <option value="CANCELLED">Annulés</option>
        </Select>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon="📝" title="Aucun devis" />
        ) : (
          <Table head={["N°", "Date", "Client", "Montant", "Validité", "Statut", ""]}>
            {rows.map((q) => {
              const st = STATUS[q.expired ? "EXPIRED" : q.status];
              return (
                <tr key={q.id}>
                  <Td className="font-medium">{q.number}</Td>
                  <Td>{new Date(q.createdAt).toLocaleDateString("fr-FR")}</Td>
                  <Td>
                    {q.customer.name}
                    {q.customer.phone && <span className="block text-xs text-gray-500">{q.customer.phone}</span>}
                  </Td>
                  <Td className="font-semibold">
                    <Money value={q.totalAmount} currency={currency} />
                  </Td>
                  <Td>{new Date(q.validUntil).toLocaleDateString("fr-FR")}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {q.sale && (
                      <Link href={`/facture/${q.sale.id}`} target="_blank" className="ml-2 text-xs text-blue-600 hover:underline">
                        {q.sale.saleNumber}
                      </Link>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Link href={`/devis/${q.id}`} target="_blank" className="text-sm text-blue-600 hover:underline">
                      Imprimer
                    </Link>
                    {q.status === "OPEN" && can("quote:cancel") && (
                      <button className="ml-3 text-sm text-red-600 hover:underline" onClick={() => setCancelling(q)}>
                        Annuler
                      </button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {creating && <QuoteForm onClose={() => setCreating(false)} onCreated={load} />}
      {cancelling && <CancelQuote quote={cancelling} onClose={() => setCancelling(null)} onDone={load} />}
    </>
  );
}

function QuoteForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { centerId, can, currency, session } = useSession();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [find, setFind] = useState("");
  const [validityDays, setValidityDays] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDiscount = can("sale:discount");
  const money = (n: number) => formatCurrency(n, currency);

  useEffect(() => {
    if (!centerId) return;
    apiGet<{ data: Product[] }>(`/api/products?centerId=${centerId}`)
      .then((r) => setProducts(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [centerId]);

  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q || !products) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q)).slice(0, 8);
  }, [find, products]);

  // Prix affiché à titre indicatif : le serveur reprend celui de la base
  const priced = lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p) return { ...l, unitPrice: 0, total: 0, symbol: "", allowsDecimal: false, factor: 1 };
    const conv = l.unitId === p.baseUnitId ? null : p.unitConversions.find((c) => c.fromUnitId === l.unitId);
    const factor = conv ? Number(conv.factor) : 1;
    const unitPrice = conv ? (conv.sellingPrice !== null ? Number(conv.sellingPrice) : Number(p.sellingPrice) * factor) : Number(p.sellingPrice);
    const q = Number(l.quantity.replace(",", ".")) || 0;
    const d = Number(l.discount.replace(",", ".")) || 0;
    return {
      ...l,
      unitPrice,
      total: Math.round((unitPrice - d) * q * 100) / 100,
      symbol: conv?.fromUnit.symbol ?? p.baseUnit.symbol,
      allowsDecimal: conv ? conv.fromUnit.allowsDecimal : p.baseUnit.allowsDecimal,
      factor,
    };
  });
  const total = priced.reduce((s, l) => s + l.total, 0);

  const addProduct = (p: Product) => {
    setLines((ls) => [...ls, { key: `${p.id}-${Date.now()}`, productId: p.id, unitId: p.baseUnitId, quantity: "1", discount: "" }]);
    setFind("");
  };
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const invalid = priced.find((l) => {
    const q = Number(l.quantity.replace(",", "."));
    return !(q > 0) || (!l.allowsDecimal && !Number.isInteger(q)) || (Number(l.discount || 0) > l.unitPrice);
  });

  const save = async () => {
    if (!centerId || !customer) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: { id: string } }>("/api/quotes", {
        centerId,
        customerId: customer.id,
        validityDays: validityDays ? Number(validityDays) : undefined,
        notes: notes || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          unitId: l.unitId,
          quantity: Number(l.quantity.replace(",", ".")),
          unitPrice: 0, // ignoré : prix de la base
          discount: Number(l.discount.replace(",", ".")) || 0,
        })),
      });
      await onCreated();
      onClose();
      window.open(`/devis/${r.data.id}`, "_blank");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const centerName = session?.centers.find((c) => c.id === centerId)?.name;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      closeOnBackdrop={false}
      title={`Nouveau devis${centerName ? ` — ${centerName}` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy} disabled={!customer || lines.length === 0 || !!invalid}>
            Enregistrer et imprimer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <CustomerPicker customer={customer} setCustomer={setCustomer} placeholder="Client du devis (nom ou téléphone)" />

      <div className="relative">
        <Input placeholder={products ? "Ajouter un article (nom, marque)" : "Chargement du catalogue…"} value={find} onChange={(e) => setFind(e.target.value)} disabled={!products} aria-label="Ajouter un article" />
        {matches.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {matches.map((p) => {
              const st = p.stocks?.[0];
              const available = st ? Number(st.quantity) - Number(st.reservedQty) : null;
              return (
                <li key={p.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => addProduct(p)}>
                    <span>
                      {p.name}
                      {available !== null && (
                        <span className={`ml-2 text-xs ${available > 0 ? "text-gray-500" : "text-red-600"}`}>
                          stock {available.toLocaleString("fr-FR")} {p.baseUnit.symbol}
                        </span>
                      )}
                    </span>
                    <span className="text-gray-600">{money(Number(p.sellingPrice))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Article</th>
                <th className="px-2 py-1.5 text-left font-medium">Unité</th>
                <th className="px-2 py-1.5 text-left font-medium">Qté</th>
                {canDiscount && <th className="px-2 py-1.5 text-left font-medium">Remise / u</th>}
                <th className="px-2 py-1.5 text-right font-medium">Montant</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {priced.map((l) => {
                const p = byId.get(l.productId);
                if (!p) return null;
                return (
                  <tr key={l.key}>
                    <td className="px-2 py-1.5">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-gray-500">{money(l.unitPrice)} / {l.symbol}</p>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={l.unitId}
                        onChange={(e) => update(l.key, { unitId: e.target.value })}
                        className="rounded border border-gray-300 px-1 py-1 text-sm"
                        aria-label="Unité"
                      >
                        <option value={p.baseUnitId}>{p.baseUnit.symbol}</option>
                        {p.unitConversions.map((c) => (
                          <option key={c.fromUnitId} value={c.fromUnitId}>
                            {c.fromUnit.symbol} ×{Number(c.factor).toLocaleString("fr-FR")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        inputMode={l.allowsDecimal ? "decimal" : "numeric"}
                        value={l.quantity}
                        onChange={(e) => update(l.key, { quantity: e.target.value })}
                        className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                        aria-label={`Quantité de ${p.name}`}
                      />
                    </td>
                    {canDiscount && (
                      <td className="px-2 py-1.5">
                        <input
                          inputMode="decimal"
                          value={l.discount}
                          onChange={(e) => update(l.key, { discount: e.target.value })}
                          placeholder="0"
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                          aria-label={`Remise sur ${p.name}`}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{money(l.total)}</td>
                    <td className="px-2 py-1.5">
                      <button type="button" className="text-red-500" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Retirer ${p.name}`}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex justify-between border-t border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
        </div>
      )}
      {invalid && <p className="text-xs text-red-600">Vérifiez les quantités (entières pour les unités non fractionnables) et les remises.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Validité (jours)" hint="Par défaut : réglage de l'entreprise">
          <Input inputMode="numeric" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} placeholder="15" />
        </Field>
        <Field label="Notes (conditions, délai de livraison…)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-gray-500">Montants en {currencyLabel(currency)}, aux prix du jour. Le stock n&apos;est pas réservé par un devis.</p>
    </Modal>
  );
}

function CancelQuote({ quote, onClose, onDone }: { quote: QuoteRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/quotes/${quote.id}/cancel`, { reason });
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
      title={`Annuler le devis ${quote.number}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 3}>
            Annuler le devis
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-gray-600">Le devis reste dans l&apos;historique et ne pourra plus être encaissé.</p>
      <Field label="Motif">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}
