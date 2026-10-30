"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Select, Spinner, Table, Td, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface TransferRow {
  id: string;
  number: string;
  status: "IN_TRANSIT" | "RECEIVED" | "CANCELLED";
  createdAt: string;
  receivedAt: string | null;
  fromCenter: { id: string; name: string };
  toCenter: { id: string; name: string };
  lineCount: number;
  value: string;
  missingValue: string;
}
interface StockRow {
  productId: string;
  quantity: string;
  reservedQty: string;
  product: { id: string; name: string; internalCode: string | null; barcode: string | null; isActive: boolean; baseUnit: { symbol: string; allowsDecimal: boolean } };
}
interface Center {
  id: string;
  name: string;
  code: string;
}

const STATUS = {
  IN_TRANSIT: { label: "En transit", tone: "amber" },
  RECEIVED: { label: "Reçu", tone: "green" },
  CANCELLED: { label: "Annulé", tone: "gray" },
} as const;

export default function TransfertsPage() {
  const { centerId, currency, can } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<TransferRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!centerId) return;
    try {
      const res = await apiGet<{ data: TransferRow[] }>(`/api/transfers?centerId=${centerId}`);
      setRows(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [centerId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const toReceive = rows?.filter((r) => r.status === "IN_TRANSIT" && r.toCenter.id === centerId) ?? [];

  return (
    <>
      <PageHeader
        title="Transferts entre centres"
        description="La marchandise quitte le centre d'origine à l'expédition et n'entre à destination qu'à la réception."
        actions={can("stock:transfer") ? <Button onClick={() => setCreating(true)}>Nouveau transfert</Button> : null}
      />
      {error && <Alert>{error}</Alert>}
      {toReceive.length > 0 && (
        <Alert tone="amber">
          {toReceive.length} transfert(s) en route vers ce centre : ouvrez-les à l&apos;arrivée de la marchandise pour la réceptionner.
        </Alert>
      )}

      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon="🚚" title="Aucun transfert">
            Envoyez de la marchandise du dépôt vers un magasin (ou entre deux magasins) avec un bon de transfert.
          </EmptyState>
        ) : (
          <Table head={["N°", "Date", "Sens", "Origine → destination", "Articles", "Valeur", "Statut", ""]}>
            {rows.map((r) => {
              const outgoing = r.fromCenter.id === centerId;
              return (
                <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/transferts/${r.id}`)}>
                  <Td className="font-mono text-xs">{r.number}</Td>
                  <Td>{formatDate(r.createdAt)}</Td>
                  <Td>
                    <Badge tone={outgoing ? "purple" : "blue"}>{outgoing ? "Sortant" : "Entrant"}</Badge>
                  </Td>
                  <Td>
                    {r.fromCenter.name} → {r.toCenter.name}
                  </Td>
                  <Td>{r.lineCount}</Td>
                  <Td>
                    <Money value={r.value} currency={currency} />
                    {Number(r.missingValue) > 0 && (
                      <span className="block text-xs text-red-600">
                        manquant <Money value={r.missingValue} currency={currency} />
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </Td>
                  <Td className="text-right text-blue-600">Ouvrir →</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {creating && centerId && (
        <NewTransferModal fromCenterId={centerId} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/transferts/${id}`)} />
      )}
    </>
  );
}

function NewTransferModal({ fromCenterId, onClose, onCreated }: { fromCenterId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [centers, setCenters] = useState<Center[] | null>(null);
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [toCenterId, setToCenterId] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiGet<{ data: Center[] }>("/api/transfers/destinations"), apiGet<{ data: StockRow[] }>(`/api/stock?centerId=${fromCenterId}`)])
      .then(([c, s]) => {
        const others = c.data.filter((x) => x.id !== fromCenterId);
        setCenters(others);
        if (others.length === 1) setToCenterId(others[0].id);
        setStock(s.data.filter((r) => Number(r.quantity) - Number(r.reservedQty) > 0));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [fromCenterId]);

  const available = (productId: string) => {
    const r = stock?.find((x) => x.productId === productId);
    return r ? Number(r.quantity) - Number(r.reservedQty) : 0;
  };
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!stock || !q) return [];
    return stock
      .filter((r) => !lines.some((l) => l.productId === r.productId))
      .filter((r) => r.product.name.toLowerCase().includes(q) || (r.product.internalCode ?? "").toLowerCase() === q || r.product.barcode === search.trim())
      .slice(0, 8);
  }, [search, stock, lines]);

  const add = (productId: string) => {
    setLines((ls) => [...ls, { productId, quantity: "" }]);
    setSearch("");
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { id: string } }>("/api/transfers", {
        fromCenterId,
        toCenterId,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity.replace(",", ".")) })),
      });
      onCreated(res.data.id);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  const valid = toCenterId && lines.length > 0 && lines.every((l) => Number(l.quantity.replace(",", ".")) > 0 && Number(l.quantity.replace(",", ".")) <= available(l.productId));

  return (
    <Modal
      open
      size="xl"
      closeOnBackdrop={false}
      title="Nouveau transfert"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={saving} disabled={!valid}>
            Expédier
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {!centers || !stock ? (
        <Spinner />
      ) : centers.length === 0 ? (
        <Alert tone="amber">Créez d&apos;abord un autre centre (Paramètres) pour pouvoir y transférer de la marchandise.</Alert>
      ) : (
        <>
          <Field label="Destination">
            <Select value={toCenterId} onChange={(e) => setToCenterId(e.target.value)}>
              <option value="">— Choisir le centre qui reçoit —</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ajouter un article" hint="Seuls les articles disponibles dans ce centre sont proposés.">
            <div className="relative">
              <Input placeholder="Nom, référence ou code-barres…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && matches[0] && add(matches[0].productId)} />
              {matches.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                  {matches.map((m) => (
                    <li key={m.productId}>
                      <button type="button" onClick={() => add(m.productId)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-blue-50">
                        <span>
                          {m.product.internalCode && <span className="mr-2 font-mono text-xs text-gray-500">{m.product.internalCode}</span>}
                          {m.product.name}
                        </span>
                        <span className="text-gray-500">
                          dispo {available(m.productId).toLocaleString("fr-FR")} {m.product.baseUnit.symbol}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
          {lines.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 border-b">
                  <th className="py-2">Article</th>
                  <th className="py-2 text-right">Disponible</th>
                  <th className="py-2 text-right">À expédier</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const r = stock.find((x) => x.productId === l.productId)!;
                  const q = Number(l.quantity.replace(",", "."));
                  const over = q > available(l.productId);
                  return (
                    <tr key={l.productId} className="border-b border-gray-100">
                      <td className="py-2">{r.product.name}</td>
                      <td className="py-2 text-right text-gray-500">
                        {available(l.productId).toLocaleString("fr-FR")} {r.product.baseUnit.symbol}
                      </td>
                      <td className="py-2 text-right">
                        <input
                          inputMode="decimal"
                          aria-label={`Quantité ${r.product.name}`}
                          autoFocus={i === lines.length - 1}
                          className={`w-24 rounded-md border px-2 py-1.5 text-right ${over ? "border-red-400 bg-red-50" : "border-gray-300"}`}
                          value={l.quantity}
                          onChange={(e) => setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, quantity: e.target.value } : x)))}
                        />
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <button type="button" className="text-gray-400 hover:text-red-600" aria-label="Retirer" onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Field label="Note (facultatif)" hint="Chauffeur, véhicule, consignes…">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
          </Field>
        </>
      )}
    </Modal>
  );
}
