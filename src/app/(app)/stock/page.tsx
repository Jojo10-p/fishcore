"use client";

import { matchesSearch } from "@/lib/search-aliases";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
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
  const [editing, setEditing] = useState<Overview | null>(null);
  const [printing, setPrinting] = useState(false);
  const [removing, setRemoving] = useState<Overview | null>(null);
  // Modifier / supprimer le stock : direction et gérant (le serveur revérifie)
  const canEdit = session?.user.role === "COMPANY_OWNER" || session?.user.role === "CENTER_MANAGER";

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
      <PageHeader
        title={alertOnly ? "Stocks en alerte" : "Stock"}
        description={centerName ? `Centre : ${centerName}` : undefined}
        actions={
          !alertOnly && overview && overview.length > 0 ? (
            <Button variant="secondary" onClick={() => setPrinting(true)}>
              🖨️ Imprimer le stock
            </Button>
          ) : undefined
        }
      />
      {printing && overview && (
        <PrintStockModal
          items={overview}
          boutique={centerName ?? ""}
          company={session?.company?.tradeName ?? ""}
          by={session ? `${session.user.firstName} ${session.user.lastName}`.trim() : ""}
          currency={session?.company?.currency ?? "XOF"}
          onClose={() => setPrinting(false)}
        />
      )}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input type="search" placeholder="🔍 Rechercher un article (ex. VIGO, CHAMPION 20W50, ORYX)" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-lg" />
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
          onEdit={canEdit ? setEditing : undefined}
          onDelete={canEdit ? setRemoving : undefined}
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
      {editing && centerId && <EditQtyModal item={editing} centerId={centerId} onClose={() => setEditing(null)} onDone={load} />}
      {removing && centerId && <DeleteItemModal item={removing} centerId={centerId} onClose={() => setRemoving(null)} onDone={load} />}
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
  onEdit,
  onDelete,
}: {
  items: Overview[] | null;
  search: string;
  show: "all" | "in" | "out";
  setShow: (s: "all" | "in" | "out") => void;
  currency: string;
  onMove?: (productId: string) => void;
  onEdit?: (item: Overview) => void;
  onDelete?: (item: Overview) => void;
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
                        <span className="flex items-center gap-1">
                          <span className={`font-bold ${out ? "text-red-600" : low ? "text-amber-600" : "text-green-700"}`}>
                            {out ? "Épuisé" : `${i.quantity.toLocaleString("fr-FR")} ${litre ? "L" : i.unit.symbol}${litre && bidon ? ` (${(i.quantity / bidon.factor).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} bidons)` : ""}`}
                          </span>
                          {(onEdit || onDelete) && (
                            <ItemMenu
                              items={[
                                ...(onEdit ? [{ label: "Modifier la quantité", onClick: () => onEdit(i) }] : []),
                                ...(onEdit ? [{ label: "Changer le prix", href: "/produits" }] : []),
                                ...(onDelete ? [{ label: "Supprimer l'article", onClick: () => onDelete(i), danger: true }] : []),
                              ]}
                            />
                          )}
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

/** Menu « ⋮ » d'un article : modifier, changer le prix, supprimer. */
function ItemMenu({ items }: { items: Array<{ label: string; onClick?: () => void; href?: string; danger?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span className="relative" ref={box}>
      <button type="button" aria-label="Actions" onClick={() => setOpen((o) => !o)} className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold leading-none text-gray-500 hover:bg-gray-100">
        ⋮
      </button>
      {open && (
        <span className="absolute right-0 z-30 mt-1 flex w-52 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-left shadow-lg">
          {items.map((it) =>
            it.href ? (
              <Link key={it.label} href={it.href} className="px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                {it.label}
              </Link>
            ) : (
              <button
                key={it.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
                className={`px-4 py-2.5 text-left text-sm hover:bg-gray-50 ${it.danger ? "text-red-600" : "text-gray-700"}`}
              >
                {it.label}
              </button>
            )
          )}
        </span>
      )}
    </span>
  );
}

/** Saisir la quantité réellement présente (en litres ou en bidons pour l'huile). */
function EditQtyModal({ item, centerId, onClose, onDone }: { item: Overview; centerId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const bidon = item.packagings.find((p) => p.symbol === "bidon");
  const litre = item.unit.symbol === "L";
  const [unit, setUnit] = useState<"base" | "bidon">("base");
  const [value, setValue] = useState(String(item.quantity));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(value.replace(",", "."));
  const qty = unit === "bidon" && bidon ? n * bidon.factor : n;
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0 && reason.trim().length >= 3;
  const unitLabel = litre ? "L" : item.unit.symbol;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/stock/edit", { centerId, productId: item.id, quantity: qty, reason: reason.trim() });
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
      title={`Modifier : ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!valid}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          En stock aujourd&apos;hui : <strong>{item.quantity.toLocaleString("fr-FR")} {unitLabel}</strong>. Entrez la quantité réellement présente ; l&apos;écart est noté dans l&apos;historique et la direction est prévenue.
        </p>
        {error && <Alert>{error}</Alert>}
        <Field label="Quantité réelle">
          <div className="flex gap-2">
            <Input type="number" inputMode="decimal" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            {bidon && (
              <Select
                value={unit}
                onChange={(e) => {
                  const u = e.target.value as "base" | "bidon";
                  const v = Number(value.replace(",", "."));
                  if (Number.isFinite(v)) setValue(String(u === "bidon" ? Math.round((v / bidon.factor) * 100) / 100 : v * bidon.factor));
                  setUnit(u);
                }}
                className="w-40"
              >
                <option value="base">{unitLabel}</option>
                <option value="bidon">bidons de {bidon.factor} {unitLabel}</option>
              </Select>
            )}
          </div>
        </Field>
        {unit === "bidon" && Number.isFinite(qty) && <p className="-mt-2 text-xs text-gray-500">Soit {qty.toLocaleString("fr-FR")} {unitLabel}</p>}
        <Field label="Motif">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : erreur de saisie, comptage du soir…" />
        </Field>
      </div>
    </Modal>
  );
}

/** Retirer un article de la boutique (stock à 0) ; ses ventes passées restent dans l'historique. */
function DeleteItemModal({ item, centerId, onClose, onDone }: { item: Overview; centerId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/stock/edit", { centerId, productId: item.id, reason: reason.trim() }, "DELETE");
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
      title="Supprimer l'article"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => void remove()} loading={busy} disabled={reason.trim().length < 3}>
            Supprimer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          <strong>{item.name}</strong> va disparaître du stock de cette boutique
          {item.quantity > 0 ? ` (il en reste ${item.quantity.toLocaleString("fr-FR")} ${item.unit.symbol === "L" ? "L" : item.unit.symbol})` : ""}. Les ventes et achats passés restent dans l&apos;historique, et la direction est prévenue.
        </p>
        <p className="text-xs text-gray-500">Il disparaît aussi de « Ajouter du stock » (si plus aucun format de cet article ne reste). Pour le remettre plus tard, retapez simplement son nom dans « Ajouter du stock ».</p>
        {error && <Alert>{error}</Alert>}
        <Field label="Motif">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : article créé par erreur, plus vendu…" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

// ── Impression du stock (A4, classé par marque, par nom ou par quantité) ──────

type PrintSort = "brand" | "name" | "qty";
type PrintShow = "all" | "in" | "out";

function PrintStockModal({ items, boutique, company, by, currency, onClose }: { items: Overview[]; boutique: string; company: string; by: string; currency: string; onClose: () => void }) {
  const [sort, setSort] = useState<PrintSort>("brand");
  const [show, setShow] = useState<PrintShow>("all");
  const [buyPrice, setBuyPrice] = useState(true);
  const list = items.filter((i) => show === "all" || (show === "in" ? i.quantity > 0 : i.quantity <= 0));
  const print = () => {
    const before = document.title;
    const d = new Date();
    document.title = `Stock ${boutique} ${d.toLocaleDateString("fr-FR").replace(/\//g, "-")}`;
    window.print();
    document.title = before;
  };
  return (
    <>
      <Modal
        open
        title="Imprimer le stock"
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Fermer
            </Button>
            <Button onClick={print} disabled={list.length === 0}>
              🖨️ Imprimer ({list.length} article{list.length > 1 ? "s" : ""})
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Classer">
            <Select value={sort} onChange={(e) => setSort(e.target.value as PrintSort)}>
              <option value="brand">Par marque (A → Z), formats regroupés</option>
              <option value="name">Par nom d&apos;article (A → Z)</option>
              <option value="qty">Par quantité (les plus bas d&apos;abord)</option>
            </Select>
          </Field>
          <Field label="Articles">
            <Select value={show} onChange={(e) => setShow(e.target.value as PrintShow)}>
              <option value="all">Tous</option>
              <option value="in">Disponibles seulement</option>
              <option value="out">Épuisés seulement</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={buyPrice} onChange={(e) => setBuyPrice(e.target.checked)} />
            Afficher le prix d&apos;achat et la valeur du stock
          </label>
          <p className="text-xs text-gray-500">Sur l&apos;écran d&apos;impression, choisissez votre imprimante ou « Enregistrer en PDF ».</p>
        </div>
      </Modal>
      <PrintableStock items={list} sort={sort} buyPrice={buyPrice} boutique={boutique} company={company} by={by} currency={currency} />
    </>
  );
}

function PrintableStock({
  items,
  sort,
  buyPrice,
  boutique,
  company,
  by,
  currency,
}: {
  items: Overview[];
  sort: PrintSort;
  buyPrice: boolean;
  boutique: string;
  company: string;
  by: string;
  currency: string;
}) {
  if (typeof document === "undefined") return null;
  const money = (v: number) => formatCurrency(v, currency);
  const qtyText = (i: Overview) => {
    const litre = i.unit.symbol === "L";
    const bidon = i.packagings.find((p) => p.symbol === "bidon");
    const base = `${i.quantity.toLocaleString("fr-FR")} ${litre ? "L" : i.unit.symbol}`;
    return litre && bidon && i.quantity > 0 ? `${base} (${(i.quantity / bidon.factor).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} bidons)` : base;
  };
  const cost = (i: Overview) => (i.lastPurchase?.unitPrice ?? 0) * Math.max(0, i.quantity);
  const sorted =
    sort === "name"
      ? [...items].sort((a, b) => a.name.localeCompare(b.name, "fr"))
      : sort === "qty"
        ? [...items].sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, "fr"))
        : groupByFamily(items).flatMap((g) => g.items);
  const groups = sort === "brand" ? groupByFamily(items) : [{ family: "", items: sorted }];
  const total = items.reduce((s, i) => s + cost(i), 0);
  const now = new Date();
  const cell = "border-b border-gray-300 px-2 py-1.5 text-left align-top";
  return createPortal(
    <div className="stock-print hidden bg-white p-[10mm] text-[11px] text-black print:block">
      <style>{`@page { size: A4; margin: 10mm; } @media print { body > *:not(.stock-print) { display: none !important; } .stock-print tr { break-inside: avoid; } }`}</style>
      <div className="mb-4 flex items-end justify-between border-b-2 border-black pb-2">
        <div>
          <p className="text-[16px] font-bold">{company}</p>
          <p className="text-[13px] font-semibold">État du stock — {boutique}</p>
        </div>
        <div className="text-right">
          <p>
            {now.toLocaleDateString("fr-FR")} à {String(now.getHours()).padStart(2, "0")}h{String(now.getMinutes()).padStart(2, "0")}
          </p>
          {by && <p>Imprimé par {by}</p>}
          <p>
            {items.length} article{items.length > 1 ? "s" : ""} · classés {sort === "brand" ? "par marque" : sort === "name" ? "par nom" : "par quantité"}
          </p>
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-100">
            <th className={cell}>Article</th>
            <th className={cell}>En stock</th>
            <th className={cell}>Prix de vente</th>
            {buyPrice && <th className={cell}>Dernier prix d&apos;achat</th>}
            {buyPrice && <th className={`${cell} text-right`}>Valeur (achat)</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <PrintGroup key={g.family || "all"} g={g} sort={sort} buyPrice={buyPrice} cell={cell} money={money} qtyText={qtyText} cost={cost} />
          ))}
        </tbody>
      </table>
      {buyPrice && (
        <div className="mt-3 flex justify-between border-t-2 border-black px-2 pt-2 text-[12px] font-bold">
          <span>Valeur totale du stock (au dernier prix d&apos;achat)</span>
          <span>{money(total)}</span>
        </div>
      )}
    </div>,
    document.body
  );
}

function PrintGroup({
  g,
  sort,
  buyPrice,
  cell,
  money,
  qtyText,
  cost,
}: {
  g: { family: string; items: Overview[] };
  sort: PrintSort;
  buyPrice: boolean;
  cell: string;
  money: (v: number) => string;
  qtyText: (i: Overview) => string;
  cost: (i: Overview) => number;
}) {
  return (
    <>
      {sort === "brand" && (
        <tr>
          <td colSpan={buyPrice ? 5 : 3} className="border-b border-gray-400 px-2 pb-1 pt-3 text-[12px] font-bold uppercase">
            {g.family}
          </td>
        </tr>
      )}
      {g.items.map((i) => (
        <tr key={i.id}>
          <td className={cell}>{sort === "brand" ? formatOf(i.name) || i.name : i.name}</td>
          <td className={`${cell} ${i.quantity <= 0 ? "font-bold" : ""}`}>{i.quantity <= 0 ? "ÉPUISÉ" : qtyText(i)}</td>
          <td className={cell}>
            {money(i.sellingPrice)}
            {i.unit.symbol === "L" ? " / L" : ""}
            {i.packagings
              .filter((p) => p.sellingPrice != null)
              .map((p) => (
                <span key={p.symbol} className="block text-[10px] text-gray-700">
                  {p.symbol === "bidon" ? "bidon" : p.name} : {money(p.sellingPrice!)}
                </span>
              ))}
          </td>
          {buyPrice && (
            <td className={cell}>
              {i.lastPurchase ? money(i.lastPurchase.unitPrice) : "—"}
              {i.lastPurchase?.supplier && <span className="block text-[10px] text-gray-700">{i.lastPurchase.supplier}</span>}
            </td>
          )}
          {buyPrice && <td className={`${cell} text-right`}>{i.quantity > 0 && i.lastPurchase ? money(cost(i)) : "—"}</td>}
        </tr>
      ))}
    </>
  );
}
