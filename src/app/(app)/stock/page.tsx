"use client";

import { matchesSearch } from "@/lib/search-aliases";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Qty, Select, Spinner, Table, Td, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import type { Permission } from "@/lib/rbac";
import { formatOf, groupByFamily } from "@/lib/product-name";
import { formatCurrency } from "@/lib/utils";

interface BatchRow {
  id: string;
  lotNumber: string | null;
  expiresAt: string | null;
  remainingQty: string;
  receivedAt: string;
}
interface StockRow {
  id: string;
  productId: string;
  quantity: string;
  reservedQty: string;
  product: {
    id: string;
    name: string;
    brand: string | null;
    category: { name: string } | null;
    stockAlertQty: string;
    trackBatches: boolean;
    isActive: boolean;
    baseUnit: { symbol: string; allowsDecimal: boolean };
    batches: BatchRow[];
  };
}

// Mouvements manuels autorisés selon le rôle (le serveur revérifie)
const MOVEMENTS: Array<{ type: string; label: string; help: string; permission: Permission; signed?: boolean }> = [
  { type: "LOSS", label: "Perte", help: "Marchandise perdue, volée ou manquante.", permission: "stock:loss" },
  { type: "DETERIORATION", label: "Détérioration / péremption", help: "Marchandise abîmée, avariée ou périmée.", permission: "stock:loss" },
  { type: "INVENTORY_ADJUST", label: "Ajustement d'inventaire", help: "Écart constaté au comptage (+ ou −).", permission: "stock:adjust", signed: true },
  { type: "CORRECTION", label: "Correction", help: "Correction d'une erreur de saisie (+ ou −).", permission: "stock:adjust", signed: true },
];

const DAY = 24 * 3600 * 1000;

/** État d'un lot vis-à-vis de sa date de péremption. */
function expiryState(expiresAt: string | null, now: number): { tone: "red" | "amber" | "green" | "gray"; label: string } {
  if (!expiresAt) return { tone: "gray", label: "Sans date" };
  const days = Math.floor((new Date(expiresAt).getTime() - now) / DAY);
  const date = new Date(expiresAt).toLocaleDateString("fr-FR");
  if (days < 0) return { tone: "red", label: `Périmé (${date})` };
  if (days <= 30) return { tone: "amber", label: `${date} · ${days} j` };
  return { tone: "green", label: date };
}

export default function StockPageWrapper() {
  return (
    <Suspense fallback={<Spinner />}>
      <StockPage />
    </Suspense>
  );
}

function StockPage() {
  const { centerId, can, session } = useSession();
  const alertOnly = useSearchParams().get("alerte") === "1";
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyExpiry, setOnlyExpiry] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adjusting, setAdjusting] = useState<{ row: StockRow; batchId?: string } | null>(null);
  const [overview, setOverview] = useState<Overview[] | null>(null);
  const [show, setShow] = useState<"all" | "in" | "out">("all");
  const [details, setDetails] = useState(false);

  const load = useCallback(async () => {
    if (!centerId) return;
    try {
      const [res, ov] = await Promise.all([
        apiGet<{ data: StockRow[] }>(`/api/stock?centerId=${centerId}${alertOnly ? "&lowStock=true" : ""}`),
        apiGet<{ data: Overview[] }>(`/api/stock/overview?centerId=${centerId}`),
      ]);
      setRows(res.data);
      setOverview(ov.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [centerId, alertOnly]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const [now] = useState(() => Date.now());
  const canMove = MOVEMENTS.some((m) => can(m.permission));
  const soon = now + 30 * DAY;
  const atRisk = (r: StockRow) => r.product.batches.some((b) => b.expiresAt && new Date(b.expiresAt).getTime() <= soon);
  const filtered =
    rows?.filter((r) => {
      const q = search.toLowerCase();
      const match = !q || matchesSearch(r.product.name, q) || r.product.brand?.toLowerCase().includes(q) || r.product.category?.name.toLowerCase().includes(q);
      return match && (!onlyExpiry || atRisk(r));
    }) ?? null;
  const centerName = session?.centers.find((c) => c.id === centerId)?.name;
  const riskCount = rows?.filter(atRisk).length ?? 0;

  return (
    <>
      <PageHeader title={alertOnly ? "Stocks en alerte" : "Stock"} description={centerName ? `Centre : ${centerName}` : undefined} />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input placeholder="Rechercher (désignation, marque, catégorie)" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />
        {riskCount > 0 && (
          <label className="inline-flex items-center gap-2 text-sm text-amber-800">
            <input type="checkbox" checked={onlyExpiry} onChange={(e) => setOnlyExpiry(e.target.checked)} />
            Péremptions à surveiller ({riskCount})
          </label>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {!alertOnly && (
        <StockCards
          items={overview}
          search={search}
          show={show}
          setShow={setShow}
          currency={session?.company?.currency ?? "XOF"}
          onMove={
            canMove
              ? (productId) => {
                  const row = rows?.find((r) => r.productId === productId);
                  if (row) setAdjusting({ row });
                }
              : undefined
          }
        />
      )}
      {!alertOnly && (
        <button className="mb-3 mt-6 text-sm text-blue-600 hover:underline" onClick={() => setDetails((d) => !d)}>
          {details ? "Masquer" : "Afficher"} le tableau détaillé (réservé caisses, lots)
        </button>
      )}
      {(alertOnly || details) && (
      <Card>
        {!filtered ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState icon="📦" title={alertOnly ? "Aucun article en alerte" : "Aucun stock"}>
            Le stock augmente à la validation d&apos;une réception.
          </EmptyState>
        ) : (
          <Table head={["Désignation", "En stock", "Réservé caisses", "Disponible", "Alerte", ""]}>
            {filtered.flatMap((r) => {
              const unit = r.product.baseUnit.symbol;
              const qty = Number(r.quantity);
              const low = qty <= Number(r.product.stockAlertQty);
              const batches = r.product.batches;
              const expired = batches.filter((b) => b.expiresAt && new Date(b.expiresAt).getTime() < now);
              const lines = [
                <tr key={r.id}>
                  <Td className="whitespace-normal min-w-48">
                    <p className="font-medium">{r.product.name}</p>
                    <p className="text-xs text-gray-500">{[r.product.brand, r.product.category?.name].filter(Boolean).join(" · ")}</p>
                    {r.product.trackBatches && batches.length > 0 && (
                      <button className="text-xs text-blue-600 hover:underline mt-0.5" onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>
                        {open[r.id] ? "Masquer" : "Voir"} les {batches.length} lot(s)
                      </button>
                    )}
                  </Td>
                  <Td className="font-semibold">
                    <Qty value={qty} unit={unit} />
                  </Td>
                  <Td className="text-gray-500">
                    <Qty value={r.reservedQty} unit={unit} />
                  </Td>
                  <Td>
                    <Qty value={qty - Number(r.reservedQty)} unit={unit} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {low && <Badge tone="amber">Stock bas</Badge>}
                      {expired.length > 0 && <Badge tone="red">{expired.length} lot(s) périmé(s)</Badge>}
                      {!low && expired.length === 0 && atRisk(r) && <Badge tone="amber">Péremption proche</Badge>}
                    </div>
                  </Td>
                  <Td>
                    {canMove && (
                      <button className="text-sm text-blue-600 hover:underline" onClick={() => setAdjusting({ row: r })}>
                        Mouvement
                      </button>
                    )}
                  </Td>
                </tr>,
              ];
              if (open[r.id]) {
                for (const b of batches) {
                  const state = expiryState(b.expiresAt, now);
                  lines.push(
                    <tr key={b.id} className="bg-gray-50">
                      <Td className="pl-8 text-sm text-gray-600">Lot {b.lotNumber ?? "sans numéro"}</Td>
                      <Td>
                        <Qty value={b.remainingQty} unit={unit} />
                      </Td>
                      <Td className="text-xs text-gray-500">reçu le {new Date(b.receivedAt).toLocaleDateString("fr-FR")}</Td>
                      <Td>{" "}</Td>
                      <Td>
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </Td>
                      <Td>
                        {canMove && (
                          <button className="text-sm text-blue-600 hover:underline" onClick={() => setAdjusting({ row: r, batchId: b.id })}>
                            {state.tone === "red" ? "Retirer" : "Mouvement"}
                          </button>
                        )}
                      </Td>
                    </tr>
                  );
                }
              }
              return lines;
            })}
          </Table>
        )}
      </Card>
      )}
      {adjusting && centerId && (
        <MovementModal
          row={adjusting.row}
          initialBatchId={adjusting.batchId}
          now={now}
          centerId={centerId}
          allowed={MOVEMENTS.filter((m) => can(m.permission))}
          onClose={() => setAdjusting(null)}
          onDone={load}
        />
      )}
    </>
  );
}

interface Overview {
  id: string;
  name: string;
  unit: { symbol: string; allowsDecimal: boolean };
  sellingPrice: number;
  stockAlertQty: number;
  quantity: number;
  reserved: number;
  packagings: Array<{ name: string; symbol: string; factor: number; sellingPrice: number | null }>;
  lastPurchase: { unitPrice: number; quantity: number | null; total: number | null; date: string | null; supplier: string | null; supplierPhone: string | null } | null;
}

/** Les infos clés de chaque article : stock, prix de vente, dernier prix d'achat chez le fournisseur. */
function StockCards({
  items,
  search,
  show,
  setShow,
  currency,
  onMove,
}: {
  items: Overview[] | null;
  search: string;
  show: "all" | "in" | "out";
  setShow: (s: "all" | "in" | "out") => void;
  currency: string;
  onMove?: (productId: string) => void;
}) {
  if (!items) return <Spinner />;
  const money = (v: number) => formatCurrency(v, currency);
  const q = search.trim();
  const list = items.filter((i) => (!q || matchesSearch(i.name, q)) && (show === "all" || (show === "in" ? i.quantity > 0 : i.quantity <= 0)));
  const counts = { all: items.length, in: items.filter((i) => i.quantity > 0).length, out: items.filter((i) => i.quantity <= 0).length };
  const groups = groupByFamily(list);
  return (
    <>
      <div className="mb-4 inline-flex rounded-xl border border-gray-300 bg-white p-1 text-sm">
        {([
          ["all", `Tous (${counts.all})`],
          ["in", `Disponibles (${counts.in})`],
          ["out", `Épuisés (${counts.out})`],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setShow(k)} className={`rounded-lg px-3 py-1.5 font-medium ${show === k ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
            {label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <Card>
          <EmptyState icon="📦" title="Aucun article">
            Les articles apparaissent ici dès le premier ajout de stock.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.family} className="p-4">
              <p className="text-base font-bold text-gray-900">{g.family}</p>
              <div className="mt-2 divide-y divide-gray-100">
                {g.items.map((i) => {
                  const out = i.quantity <= 0;
                  const low = !out && i.quantity <= i.stockAlertQty;
                  const bidon = i.packagings.find((p) => p.symbol === "bidon");
                  const litre = i.unit.symbol === "L";
                  const buy = i.lastPurchase?.unitPrice ?? 0;
                  const margin = buy > 0 ? i.sellingPrice - buy : null;
                  return (
                    <div key={i.id} className="py-2.5 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-gray-800">{formatOf(i.name) || "Article"}</span>
                        <span className={`font-bold ${out ? "text-red-600" : low ? "text-amber-600" : "text-green-700"}`}>
                          {out ? "Épuisé" : `${i.quantity.toLocaleString("fr-FR")} ${litre ? "L" : i.unit.symbol}${litre && bidon ? ` (${(i.quantity / bidon.factor).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} bidons)` : ""}`}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-600">
                        <span>
                          Vente : <strong className="text-gray-900">{money(i.sellingPrice)}</strong>
                          {litre ? " / L" : ""}
                        </span>
                        <span>
                          Achat : <strong className="text-gray-900">{buy > 0 ? money(buy) : "—"}</strong>
                          {litre && buy > 0 ? " / L" : ""}
                        </span>
                        {litre && bidon?.sellingPrice != null && (
                          <span>
                            Bidon : <strong className="text-gray-900">{money(bidon.sellingPrice)}</strong>
                          </span>
                        )}
                        {margin != null && (
                          <span className={margin >= 0 ? "text-green-700" : "text-red-700"}>
                            {margin >= 0 ? "Bénéfice" : "Perte"} : {money(Math.abs(margin))}
                            {litre ? " / L" : ""}
                          </span>
                        )}
                      </div>
                      {i.lastPurchase?.supplier && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          Acheté chez {i.lastPurchase.supplier}
                          {i.lastPurchase.supplierPhone ? ` (${i.lastPurchase.supplierPhone})` : ""}
                          {i.lastPurchase.date ? ` le ${new Date(i.lastPurchase.date).toLocaleDateString("fr-FR")}` : ""}
                        </p>
                      )}
                      {onMove && !out && (
                        <button className="mt-1 text-xs text-blue-600 hover:underline" onClick={() => onMove(i.id)}>
                          Mouvement (perte, correction…)
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function MovementModal({
  row,
  initialBatchId,
  now,
  centerId,
  allowed,
  onClose,
  onDone,
}: {
  row: StockRow;
  initialBatchId?: string;
  now: number;
  centerId: string;
  allowed: typeof MOVEMENTS;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const initialBatch = row.product.batches.find((b) => b.id === initialBatchId);
  const isExpired = !!initialBatch?.expiresAt && new Date(initialBatch.expiresAt).getTime() < now;
  const [type, setType] = useState(isExpired && allowed.some((m) => m.type === "DETERIORATION") ? "DETERIORATION" : (allowed[0]?.type ?? ""));
  const [batchId, setBatchId] = useState(initialBatchId ?? (row.product.trackBatches ? (row.product.batches[0]?.id ?? "") : ""));
  const [quantity, setQuantity] = useState(isExpired && initialBatch ? String(Number(initialBatch.remainingQty)) : "");
  const [reason, setReason] = useState(isExpired ? "Lot périmé retiré de la vente" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const movement = allowed.find((m) => m.type === type);
  const unit = row.product.baseUnit.symbol;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/stock", {
        centerId,
        productId: row.productId,
        type,
        quantity: Number(quantity.replace(",", ".")),
        reason,
        ...(batchId ? { batchId } : {}),
      });
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
      title={`Mouvement — ${row.product.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy} disabled={!quantity || Number(quantity) === 0 || reason.trim().length < 3 || (row.product.trackBatches && !batchId)}>
            Enregistrer
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        Stock actuel :{" "}
        <strong>
          <Qty value={row.quantity} unit={unit} />
        </strong>
        . Chaque mouvement est justifié et historisé ; le stock ne peut pas devenir négatif.
      </p>
      {error && <Alert>{error}</Alert>}
      <Field label="Type de mouvement" hint={movement?.help}>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {allowed.map((m) => (
            <option key={m.type} value={m.type}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      {row.product.trackBatches && (
        <Field label="Lot concerné">
          <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">Choisir un lot…</option>
            {row.product.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.lotNumber ?? "Sans numéro"} — reste {Number(b.remainingQty)} {unit} — {expiryState(b.expiresAt, now).label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={`Quantité (${unit})`} hint={movement?.signed ? "Positive pour ajouter, négative pour retirer." : "Quantité retirée du stock."}>
        <Input inputMode={row.product.baseUnit.allowsDecimal ? "decimal" : "numeric"} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </Field>
      <Field label="Motif (obligatoire)">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}
