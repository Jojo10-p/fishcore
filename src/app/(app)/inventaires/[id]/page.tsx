"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, Field, Input, Modal, Money, PageHeader, Spinner, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface Line {
  id: string;
  productId: string;
  theoreticalQty: string;
  countedQty: string | null;
  discrepancy: string | null;
  unitCost: string;
  discrepancyReason: string | null;
  product: {
    id: string;
    name: string;
    internalCode: string | null;
    barcode: string | null;
    trackBatches: boolean;
    category: { name: string } | null;
    baseUnit: { symbol: string; allowsDecimal: boolean };
  };
}
interface Summary {
  lineCount: number;
  countedCount: number;
  gapValue: string;
  shortageValue: string;
  surplusValue: string;
}
interface Inventory {
  id: string;
  number: string;
  label: string | null;
  status: "IN_PROGRESS" | "VALIDATED" | "CANCELLED";
  createdAt: string;
  validatedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  startedBy: string | null;
  validatedBy: string | null;
  cancelledBy: string | null;
  center: { name: string };
  summary: Summary;
  lines: Line[];
}

type Filter = "all" | "todo" | "gaps";
const fmt = (v: string | number | null) => (v === null ? "" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 }));
const parseQty = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export default function InventoryPage() {
  const { id } = useParams<{ id: string }>();
  const { currency, can } = useSession();
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [validating, setValidating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ data: Inventory }>(`/api/inventories/${id}`);
      setInv(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const editable = inv?.status === "IN_PROGRESS" && can("inventory:start");

  const visible = useMemo(() => {
    if (!inv) return [];
    const q = search.trim().toLowerCase();
    return inv.lines.filter((l) => {
      if (filter === "todo" && l.countedQty !== null) return false;
      if (filter === "gaps" && (l.discrepancy === null || Number(l.discrepancy) === 0)) return false;
      if (!q) return true;
      return (
        l.product.name.toLowerCase().includes(q) ||
        (l.product.internalCode ?? "").toLowerCase() === q ||
        (l.product.barcode ?? "") === search.trim() ||
        (l.product.category?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [inv, filter, search]);

  /** Enregistre la quantité comptée d'une ligne (vide = non comptée). */
  const save = async (line: Line, raw: string, reason?: string) => {
    const trimmed = raw.trim();
    const countedQty = trimmed === "" ? null : parseQty(trimmed);
    if (countedQty !== null && (Number.isNaN(countedQty) || countedQty < 0)) {
      setSaving((s) => ({ ...s, [line.productId]: "error" }));
      setError(`Quantité invalide pour « ${line.product.name} »`);
      return;
    }
    const same = (countedQty === null && line.countedQty === null) || (countedQty !== null && line.countedQty !== null && Number(line.countedQty) === countedQty);
    if (same && reason === undefined) return;
    setSaving((s) => ({ ...s, [line.productId]: "saving" }));
    try {
      const res = await apiSend<{ data: { lines: Array<Partial<Line> & { productId: string }>; summary: Summary } }>(
        `/api/inventories/${id}`,
        { lines: [{ productId: line.productId, countedQty, reason: reason ?? line.discrepancyReason ?? undefined }] },
        "PATCH"
      );
      setInv((cur) =>
        cur
          ? {
              ...cur,
              summary: res.data.summary,
              lines: cur.lines.map((l) => {
                const u = res.data.lines.find((x) => x.productId === l.productId);
                return u ? { ...l, ...u } : l;
              }),
            }
          : cur
      );
      setDrafts((d) => {
        const n = { ...d };
        delete n[line.productId];
        return n;
      });
      setSaving((s) => ({ ...s, [line.productId]: "saved" }));
      setError(null);
    } catch (e) {
      setSaving((s) => ({ ...s, [line.productId]: "error" }));
      setError(errorMessage(e));
    }
  };

  /** Scan / saisie d'une référence : va directement à la case « compté » de l'article. */
  const onSearchEnter = () => {
    if (!inv) return;
    const q = search.trim();
    const hit = inv.lines.find((l) => l.product.barcode === q || (l.product.internalCode ?? "").toLowerCase() === q.toLowerCase());
    if (hit) {
      setFilter("all");
      setSearch("");
      setTimeout(() => {
        inputs.current[hit.productId]?.focus();
        inputs.current[hit.productId]?.select();
      }, 0);
    }
  };

  const focusNext = (productId: string) => {
    const idx = visible.findIndex((l) => l.productId === productId);
    const next = visible[idx + 1];
    if (next) inputs.current[next.productId]?.focus();
  };

  if (error && !inv) return <Alert>{error}</Alert>;
  if (!inv) return <Spinner />;

  const s = inv.summary;
  const status = { IN_PROGRESS: ["En cours", "amber"], VALIDATED: ["Validé", "green"], CANCELLED: ["Annulé", "gray"] } as const;

  return (
    <>
      <PageHeader
        title={`Inventaire ${inv.number}`}
        description={`${inv.center.name}${inv.label ? ` · ${inv.label}` : ""} · ouvert le ${formatDate(inv.createdAt, true)}${inv.startedBy ? ` par ${inv.startedBy}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/inventaires">
              <Button variant="secondary">← Inventaires</Button>
            </Link>
            <a href={`/inventaire/${inv.id}${inv.status === "IN_PROGRESS" ? "?vierge=1" : ""}`} target="_blank" rel="noreferrer">
              <Button variant="secondary">🖨 {inv.status === "IN_PROGRESS" ? "Feuille de comptage" : "Imprimer"}</Button>
            </a>
            {inv.status === "IN_PROGRESS" && can("inventory:validate") && (
              <>
                <Button variant="secondary" onClick={() => setCancelling(true)}>
                  Abandonner
                </Button>
                <Button onClick={() => setValidating(true)}>Valider l&apos;inventaire</Button>
              </>
            )}
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      {inv.status === "VALIDATED" && (
        <Alert tone="green">
          Validé le {formatDate(inv.validatedAt!, true)}
          {inv.validatedBy ? ` par ${inv.validatedBy}` : ""} : les écarts ont été appliqués au stock.
        </Alert>
      )}
      {inv.status === "CANCELLED" && (
        <Alert tone="amber">
          Abandonné le {formatDate(inv.cancelledAt!, true)}
          {inv.cancelledBy ? ` par ${inv.cancelledBy}` : ""} — aucun effet sur le stock. {inv.notes}
        </Alert>
      )}

      <div className="mb-3">
        <Badge tone={status[inv.status][1]}>{status[inv.status][0]}</Badge>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Articles comptés" value={`${s.countedCount} / ${s.lineCount}`} />
        <Stat label="Manquants" value={<Money value={s.shortageValue} currency={currency} />} tone="red" />
        <Stat label="Surplus" value={<Money value={s.surplusValue} currency={currency} />} tone="green" />
        <Stat label="Écart net" value={<Money value={s.gapValue} currency={currency} />} tone={Number(s.gapValue) < 0 ? "red" : Number(s.gapValue) > 0 ? "green" : undefined} />
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-gray-100">
          <Input
            placeholder="Scanner un code-barres, saisir une référence ou chercher un article…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearchEnter()}
            className="flex-1"
            autoFocus={editable}
          />
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm shrink-0">
            {(
              [
                ["all", `Tous (${inv.lines.length})`],
                ["todo", `À compter (${s.lineCount - s.countedCount})`],
                ["gaps", "Écarts"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-3 py-2 ${filter === k ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <th className="px-4 py-3 font-medium">Réf.</th>
                <th className="px-4 py-3 font-medium">Article</th>
                <th className="px-4 py-3 font-medium text-right">Théorique</th>
                <th className="px-4 py-3 font-medium text-right">Compté</th>
                <th className="px-4 py-3 font-medium text-right">Écart</th>
                <th className="px-4 py-3 font-medium text-right">Valeur</th>
                <th className="px-4 py-3 font-medium">Motif</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((l) => {
                const gap = l.discrepancy === null ? null : Number(l.discrepancy);
                const st = saving[l.productId];
                return (
                  <tr key={l.productId} className={l.countedQty === null ? "" : "bg-gray-50/50"}>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{l.product.internalCode ?? ""}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{l.product.name}</div>
                      <div className="text-xs text-gray-500">
                        {l.product.category?.name ?? "Sans famille"}
                        {l.product.trackBatches ? " · suivi par lot" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap text-gray-600">
                      {fmt(l.theoreticalQty)} <span className="text-xs">{l.product.baseUnit.symbol}</span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {editable ? (
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            ref={(el) => {
                              inputs.current[l.productId] = el;
                            }}
                            inputMode="decimal"
                            aria-label={`Quantité comptée ${l.product.name}`}
                            className={`w-24 rounded-md border px-2 py-1.5 text-right ${st === "error" ? "border-red-400 bg-red-50" : "border-gray-300"} focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200`}
                            value={drafts[l.productId] ?? (l.countedQty === null ? "" : fmt(l.countedQty))}
                            onChange={(e) => setDrafts((d) => ({ ...d, [l.productId]: e.target.value }))}
                            onBlur={(e) => void save(l, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void save(l, (e.target as HTMLInputElement).value);
                                focusNext(l.productId);
                              }
                            }}
                          />
                          <span className="w-4 text-xs">{st === "saving" ? "…" : st === "saved" ? <span className="text-green-600">✓</span> : st === "error" ? <span className="text-red-600">!</span> : ""}</span>
                        </div>
                      ) : l.countedQty === null ? (
                        <span className="text-gray-400">non compté</span>
                      ) : (
                        fmt(l.countedQty)
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right whitespace-nowrap font-medium ${gap === null ? "" : gap < 0 ? "text-red-600" : gap > 0 ? "text-green-700" : "text-gray-400"}`}>
                      {gap === null ? "" : `${gap > 0 ? "+" : ""}${fmt(gap)}`}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap text-gray-600">
                      {gap ? <Money value={gap * Number(l.unitCost)} currency={currency} /> : ""}
                    </td>
                    <td className="px-4 py-2">
                      {editable && gap ? (
                        <input
                          className="w-40 rounded-md border border-gray-200 px-2 py-1 text-xs"
                          placeholder="Casse, vol, erreur…"
                          defaultValue={l.discrepancyReason ?? ""}
                          maxLength={200}
                          onBlur={(e) => e.target.value !== (l.discrepancyReason ?? "") && void save(l, l.countedQty ?? "", e.target.value)}
                        />
                      ) : (
                        <span className="text-xs text-gray-500">{l.discrepancyReason}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Aucun article dans cette vue.</p>}
        </div>
      </Card>

      {validating && (
        <ValidateModal
          inv={inv}
          currency={currency}
          onClose={() => setValidating(false)}
          onDone={(msg) => {
            setValidating(false);
            setNotice(msg);
            void load();
          }}
        />
      )}
      {cancelling && (
        <CancelModal
          id={inv.id}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "red" | "green" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === "red" ? "text-red-600" : tone === "green" ? "text-green-700" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

function ValidateModal({ inv, currency, onClose, onDone }: { inv: Inventory; currency: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [uncounted, setUncounted] = useState<"keep" | "zero">("keep");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const todo = inv.summary.lineCount - inv.summary.countedCount;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { adjusted: number; clamped: string[] } }>(`/api/inventories/${inv.id}/validate`, { uncounted });
      onDone(
        `Inventaire validé : ${res.data.adjusted} article(s) corrigé(s) dans le stock.` +
          (res.data.clamped.length ? ` Stock ramené à zéro (ventes depuis le comptage) : ${res.data.clamped.join(", ")}.` : "")
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Valider l'inventaire ${inv.number}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Retour
          </Button>
          <Button onClick={submit} loading={busy}>
            Appliquer les écarts au stock
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-gray-700">
        Écart net : <strong><Money value={inv.summary.gapValue} currency={currency} /></strong> ({inv.summary.countedCount} article(s) compté(s)). Cette opération est
        définitive et tracée.
      </p>
      {todo > 0 && (
        <Field label={`${todo} article(s) non compté(s)`}>
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" checked={uncounted === "keep"} onChange={() => setUncounted("keep")} className="mt-1" />
              <span>
                <strong>Laisser leur stock tel quel</strong> — inventaire partiel (un rayon, une famille).
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" checked={uncounted === "zero"} onChange={() => setUncounted("zero")} className="mt-1" />
              <span>
                <strong>Les mettre à zéro</strong> — inventaire complet : ce qui n&apos;a pas été trouvé n&apos;est plus en stock.
              </span>
            </label>
          </div>
        </Field>
      )}
    </Modal>
  );
}

function CancelModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/inventories/${id}/cancel`, { reason });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Abandonner l'inventaire"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Retour
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 3}>
            Abandonner
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-gray-700">Les quantités saisies sont conservées pour mémoire, mais le stock ne sera pas modifié.</p>
      <Field label="Motif">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
      </Field>
    </Modal>
  );
}
