"use client";

import { fractionUnits, HALF, QUARTER } from "@/lib/client/fraction-units";
import { matchesSearch } from "@/lib/search-aliases";
import { phonesOf } from "@/lib/phones";
import { PhonesInput, phonesPayload } from "@/components/app/phones-input";
import { COMMON_FORMATS, FORMAT_SEP, composeName, familyOf, formatLiters, litersLabel } from "@/lib/product-name";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { useOnline } from "@/components/app/connection-badge";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Qty, Select, Spinner, Table, Td } from "@/components/ui";
import { useAutosaveDraft } from "@/hooks/use-autosave-draft";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface Receipt {
  id: string;
  reference: string | null;
  receivedAt: string;
  isValidated: boolean;
  validatedAt: string | null;
  transportCost: string;
  iceCost: string;
  handlingCost: string;
  otherCosts: string;
  supplier: { name: string } | null;
  paymentMode?: string | null;
  purchase?: { dueDate: string | null; totalAmount: string; paidAmount: string } | null;
  lines: Array<{
    id: string;
    quantity: string;
    packageCount: number | null;
    totalPrice: string;
    lotNumber: string | null;
    expiresAt: string | null;
    product: { name: string; baseUnit: { symbol: string } };
  }>;
}
interface ProductOption {
  id: string;
  name: string;
  purchasePrice: string;
  sellingPrice: string;
  baseUnit: { symbol: string };
  stocks?: Array<{ quantity: string }>;
}
interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
  otherPhones?: string[];
}
interface Unit {
  id: string;
  symbol: string;
  name: string;
}

// Saisie GJH : un arrivage = des lignes « article, nombre de bidons, litres par bidon,
// prix du lot, prix de vente ». Un article qui n'existe pas encore est créé.
interface DraftLine {
  name: string;
  liters: string;
  buyMode: "carton" | "unit";
  cartons: string;
  perCarton: string;
  cartonPrice: string;
  quantity: string;
  lotPrice: string;
  sellingPrice: string;
  cartonSellingPrice: string;
  lotSize: string;
  lotPrice2: string;
  /** Ligne ouverte avec « Ajouter un nouveau produit » : article jamais vendu ici. */
  fresh?: boolean;
  /** Vendu aussi au détail (litre, ½ L, ¼ L) : stock compté en litres */
  retail?: boolean;
  /** Prix du bidon entier (vente au détail) */
  bidonPrice?: string;
  /** Prix propres du ½ litre et du ¼ litre (sinon prix du litre × ½ ou ¼) */
  halfPrice?: string;
  quarterPrice?: string;
  /** Article d'origine (modification d'un arrivage) : gardé tant que le nom et le format ne changent pas */
  productId?: string;
}
interface ReceiptDraft {
  supplierId: string;
  reference: string;
  receivedAt: string;
  transportCost: string;
  handlingCost: string;
  lines: DraftLine[];
  /** Déjà payé ou pris à crédit (obligatoire) */
  paymentMode?: "" | "PAID" | "CREDIT";
  paymentMethod?: string;
  dueDate?: string;
}

const emptyLine = (fresh = false): DraftLine => ({
  fresh,
  name: "",
  liters: "",
  buyMode: "carton",
  cartons: "",
  perCarton: "",
  cartonPrice: "",
  quantity: "",
  lotPrice: "",
  sellingPrice: "",
  cartonSellingPrice: "",
  lotSize: "",
  lotPrice2: "",
});
const emptyDraft = (fresh = false): ReceiptDraft => ({
  supplierId: "",
  reference: "",
  receivedAt: new Date().toISOString().slice(0, 10),
  transportCost: "",
  handlingCost: "",
  lines: [emptyLine(fresh)],
  paymentMode: "",
  paymentMethod: "CASH",
  dueDate: "",
});
const num = (v: string) => Number((v || "0").replace(",", "."));

export default function ReceptionsPage() {
  const { centerId, currency, can, session } = useSession();
  // Modifier un arrivage : direction et gérant (le serveur revérifie)
  const canEdit = session?.user.role === "COMPANY_OWNER" || session?.user.role === "CENTER_MANAGER";
  const [now] = useState(() => Date.now());
  const [editing, setEditing] = useState<{ id: string; draft: ReceiptDraft } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Receipt | null>(null);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  // Recherche : article, fournisseur, référence ou date (ex. « VIGO », « 15/11 »)
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim();
    if (!receipts || !q) return receipts;
    return receipts.filter(
      (r) =>
        r.lines.some((l) => matchesSearch(l.product.name, q)) ||
        matchesSearch(r.supplier?.name ?? "", q) ||
        matchesSearch(r.reference ?? "", q) ||
        new Date(r.receivedAt).toLocaleDateString("fr-FR").includes(q)
    );
  }, [receipts, search]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<false | "stock" | "new">(false);
  const [validating, setValidating] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!centerId) return;
    try {
      const res = await apiGet<{ data: Receipt[] }>(`/api/goods-receipts?centerId=${centerId}`);
      setReceipts(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [centerId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const openEdit = async (id: string) => {
    setOpening(id);
    setError(null);
    try {
      const r = await apiGet<{ data: EditableReceipt }>(`/api/goods-receipts/${id}`);
      setCreating(false);
      setEditing({ id, draft: draftFromReceipt(r.data) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(null);
    }
  };

  const validate = async (id: string) => {
    if (!window.confirm("Valider cette réception ? Le stock sera augmenté et la réception ne pourra plus être modifiée.")) return;
    setValidating(id);
    try {
      await apiSend(`/api/goods-receipts/${id}/validate`, {});
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setValidating(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Ajouter du stock"
        description="Marchandise reçue du fournisseur : le stock augmente dès que l'arrivage est enregistré."
        actions={
          !creating && !editing && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setCreating("new")}>
                ✨ Ajouter un nouveau produit
              </Button>
              <Button onClick={() => setCreating("stock")}>+ Ajouter du stock</Button>
            </div>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      {editing && centerId && (
        <div className="mb-6">
          <ReceiptForm
            key={editing.id}
            editId={editing.id}
            initial={editing.draft}
            centerId={centerId}
            currency={currency}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await load();
            }}
          />
        </div>
      )}
      {creating && centerId && (
        <div className="mb-6">
          <ReceiptForm
            startNew={creating === "new"}
            centerId={centerId}
            currency={currency}
            onCancel={() => setCreating(false)}
            onSaved={async () => {
              setCreating(false);
              await load();
            }}
          />
        </div>
      )}
      {receipts && receipts.length > 0 && (
        <div className="mb-3">
          <Input
            type="search"
            placeholder="🔍 Rechercher un arrivage : article, fournisseur, référence, date (ex. VIGO, 15/11)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-lg"
          />
        </div>
      )}
      <Card>
        {!receipts || !shown ? (
          <Spinner />
        ) : receipts.length === 0 ? (
          <EmptyState icon="🚚" title="Aucun arrivage enregistré" />
        ) : shown.length === 0 ? (
          <EmptyState icon="🔍" title="Aucun arrivage ne correspond">Essayez un autre mot (nom de l&apos;article, du fournisseur…).</EmptyState>
        ) : (
          <Table head={["Date", "Fournisseur", "Articles reçus", "Coût total", "Statut", ""]}>
            {shown.map((r) => {
              const goods = r.lines.reduce((s, l) => s + Number(l.totalPrice), 0);
              const fees = num(r.transportCost) + num(r.iceCost) + num(r.handlingCost) + num(r.otherCosts);
              return (
                <tr key={r.id}>
                  <Td>
                    {new Date(r.receivedAt).toLocaleDateString("fr-FR")}
                    {r.reference && <p className="text-xs text-gray-500">{r.reference}</p>}
                  </Td>
                  <Td>
                    {r.supplier?.name ?? "—"}
                    <PayBadge r={r} now={now} />
                  </Td>
                  <Td className="whitespace-normal">
                    {r.lines.map((l) => (
                      <span key={l.id} className="block">
                        {l.product.name} — <Qty value={l.quantity} unit={l.product.baseUnit.symbol} />
                        {l.lotNumber && <span className="text-xs text-gray-500"> · lot {l.lotNumber}</span>}
                        {l.expiresAt && <span className="text-xs text-gray-500"> · exp. {new Date(l.expiresAt).toLocaleDateString("fr-FR")}</span>}
                      </span>
                    ))}
                  </Td>
                  <Td>
                    <Money value={goods + fees} currency={currency} />
                    {fees > 0 && <p className="text-xs text-gray-500">dont frais <Money value={fees} currency={currency} /></p>}
                  </Td>
                  <Td>{r.isValidated ? <Badge tone="green">Validée</Badge> : <Badge tone="gray">Brouillon</Badge>}</Td>
                  <Td>
                    <span className="flex items-center justify-end gap-2">
                      {!r.isValidated && can("stock:receive") && (
                        <Button variant="success" className="px-3 py-1.5" loading={validating === r.id} onClick={() => validate(r.id)}>
                          Valider
                        </Button>
                      )}
                      {canEdit && (
                        <RowMenu
                          busy={opening === r.id}
                          items={[
                            { label: "✏️ Modifier l'arrivage", onClick: () => void openEdit(r.id) },
                            { label: "🗑️ Supprimer l'arrivage", onClick: () => setRemoving(r), danger: true },
                          ]}
                        />
                      )}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {removing && (
        <DeleteReceiptModal
          receipt={removing}
          onClose={() => setRemoving(null)}
          onDone={async () => {
            setRemoving(null);
            if (editing?.id === removing.id) setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

/** Supprimer un arrivage : sa marchandise sort du stock, il disparaît de la liste. */
function DeleteReceiptModal({ receipt, onClose, onDone }: { receipt: Receipt; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/goods-receipts/${receipt.id}`, { reason: reason.trim() }, "DELETE");
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Supprimer l'arrivage"
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
          L&apos;arrivage du <strong>{new Date(receipt.receivedAt).toLocaleDateString("fr-FR")}</strong>
          {receipt.supplier ? ` (${receipt.supplier.name})` : ""} va disparaître, et sa marchandise sort du stock :
        </p>
        <ul className="list-disc pl-5 text-sm text-gray-700">
          {receipt.lines.map((l) => (
            <li key={l.id}>
              {l.product.name} — <Qty value={l.quantity} unit={l.product.baseUnit.symbol} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">Impossible si une partie a déjà été vendue : dans ce cas, modifiez l&apos;arrivage. La suppression est notée dans l&apos;historique et la direction est prévenue.</p>
        {error && <Alert>{error}</Alert>}
        <Field label="Motif">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. : arrivage saisi deux fois, erreur…" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

interface EditableReceipt {
  reference: string | null;
  receivedAt: string;
  transportCost: string;
  handlingCost: string;
  supplier: { id: string } | null;
  paymentMode?: string | null;
  paymentMethod?: string | null;
  purchase?: { dueDate: string | null } | null;
  lines: Array<{ quantity: string; totalPrice: string; product: { id: string; name: string; sellingPrice: string; baseUnit: { symbol: string } } }>;
}

/** Arrivage enregistré → formulaire pré-rempli (achat « à l'unité », prix total de la ligne). */
function draftFromReceipt(r: EditableReceipt): ReceiptDraft {
  return {
    supplierId: r.supplier?.id ?? "",
    reference: r.reference ?? "",
    receivedAt: r.receivedAt.slice(0, 10),
    transportCost: Number(r.transportCost) ? String(Number(r.transportCost)) : "",
    handlingCost: Number(r.handlingCost) ? String(Number(r.handlingCost)) : "",
    paymentMode: r.paymentMode === "PAID" || r.paymentMode === "CREDIT" ? r.paymentMode : "",
    paymentMethod: r.paymentMethod ?? "CASH",
    dueDate: r.purchase?.dueDate ? r.purchase.dueDate.slice(0, 10) : "",
    lines: r.lines.map((l) => {
      const retail = l.product.baseUnit.symbol === "L";
      const liters = formatLiters(l.product.name);
      const qty = Number(l.quantity);
      return {
        ...emptyLine(),
        productId: l.product.id,
        name: familyOf(l.product.name),
        liters: liters ? String(liters) : "",
        buyMode: "unit" as const,
        retail,
        // Détail : stock compté en litres → nombre de bidons reçus
        quantity: String(retail && liters ? Math.round((qty / liters) * 1000) / 1000 : qty),
        lotPrice: String(Number(l.totalPrice)),
        sellingPrice: String(Number(l.product.sellingPrice)),
      };
    }),
  };
}

/** Prix déjà fixé pour le ½ L (0.5) ou le ¼ L (0.25) d'un article, en texte. */
function priceOfFraction(p: ProductFull | null | undefined, units: Unit[], f: 0.5 | 0.25): string | undefined {
  const symbol = f === 0.5 ? HALF.symbol : QUARTER.symbol;
  const unitId = units.find((u) => u.symbol === symbol)?.id;
  const c = unitId ? p?.unitConversions?.find((u) => u.fromUnitId === unitId) : undefined;
  return c?.sellingPrice != null ? String(Number(c.sellingPrice)) : undefined;
}

/** Menu « ⋮ » d'une ligne du tableau. */
function RowMenu({ items, busy }: { items: Array<{ label: string; onClick: () => void; danger?: boolean }>; busy?: boolean }) {
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
      <button type="button" aria-label="Actions" disabled={busy} onClick={() => setOpen((o) => !o)} className="flex h-9 w-9 items-center justify-center rounded-full text-xl font-bold leading-none text-gray-500 hover:bg-gray-100 disabled:opacity-50">
        {busy ? "…" : "⋮"}
      </button>
      {open && (
        <span className="absolute right-0 z-30 mt-1 flex w-56 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-left shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={`px-4 py-2.5 text-left text-sm hover:bg-gray-50 ${it.danger ? "text-red-600" : "text-gray-700"}`}
            >
              {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// ── Nouvel arrivage (saisie GJH, brouillon sauvegardé sur l'appareil) ─────────
// Chaque ligne : l'article (suggestions en tapant), sa contenance, l'achat au
// carton (nombre de cartons × bidons par carton, prix d'un carton) ou à l'unité,
// puis les prix de vente : le bidon, le carton, un lot (ex. lot de 3).
const PLURAL: Record<string, string> = { btl: "bouteilles", bidon: "bidons", seau: "seaux", "fût": "fûts", carton: "cartons", pce: "pièces", L: "litres" };
const unitWord = (symbol?: string) => (symbol ? (PLURAL[symbol] ?? symbol) : "bidons");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** Contenance lue dans le nom de l'article : « — bidon 4 L » → 4, « 500 ml » → 0,5. */
function litersFromName(name: string): number | null {
  const ml = name.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (ml) return Number(ml[1].replace(",", ".")) / 1000;
  const l = name.match(/(\d+(?:[.,]\d+)?)\s*l\b/i);
  return l ? Number(l[1].replace(",", ".")) : null;
}
const fmtL = (n: number) => litersLabel(n);
/** Nom tapé ou choisi → marque/produit + litres (« SHELL HELIX 4L » → SHELL HELIX, 4) */
function splitName(name: string): { family: string; liters: number | null } {
  if (name.includes(FORMAT_SEP)) return { family: familyOf(name), liters: formatLiters(name) };
  const liters = litersFromName(name);
  const family = liters ? name.replace(/\s*[-—]?\s*(bidon\s+)?\d+(?:[.,]\d+)?\s*(ml|l)\b/i, "").trim() : name.trim();
  return { family: family || name.trim(), liters };
}

interface Suggestion {
  id: string;
  name: string;
  liters: number | null;
  unitsPerCarton: number | null;
  category?: string | null;
}
interface ProductFull extends ProductOption {
  baseUnitId: string;
  unitConversions?: Array<{ fromUnitId: string; factor: string; sellingPrice: string | null; barcode: string | null }>;
}

function ReceiptForm({
  centerId,
  currency,
  startNew = false,
  editId,
  initial,
  onCancel,
  onSaved,
}: {
  centerId: string;
  currency: string;
  startNew?: boolean;
  /** Modification d'un arrivage déjà enregistré */
  editId?: string;
  initial?: ReceiptDraft;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const online = useOnline();
  const { can } = useSession();
  // Prix d'un article déjà en stock : seuls la direction et le gérant les changent
  const canPrice = can("product:price");
  const [draft, setDraft] = useState<ReceiptDraft>(() => initial ?? emptyDraft(startNew));
  const [hydrated, setHydrated] = useState(!editId);
  const [phoneEdit, setPhoneEdit] = useState<string[] | null>(null);
  const [products, setProducts] = useState<ProductFull[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [newSupplier, setNewSupplier] = useState<{ name: string; phones: string[] } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [showFees, setShowFees] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const touched = useMemo(() => draft.supplierId !== "" || draft.reference !== "" || draft.lines.some((l) => l.name || l.quantity || l.lotPrice), [draft]);
  // Un arrivage en cours de modification n'est pas gardé comme brouillon local
  const autosave = useAutosaveDraft(`goods-receipt:v4:${centerId}`, draft, { enabled: touched && !editId });

  const loadProducts = useCallback(() => {
    apiGet<{ data: ProductFull[] }>(`/api/products?centerId=${centerId}`).then((r) => setProducts(r.data)).catch(() => undefined);
  }, [centerId]);
  useEffect(() => {
    loadProducts();
    apiGet<{ data: Supplier[] }>("/api/suppliers").then((r) => setSuppliers(r.data)).catch(() => undefined);
    apiGet<{ data: Unit[] }>("/api/units").then((r) => setUnits(r.data)).catch(() => undefined);
    apiGet<{ data: Suggestion[] }>(`/api/product-suggestions?centerId=${centerId}`).then((r) => setSuggestions(r.data)).catch(() => undefined);
  }, [loadProducts, centerId]);

  const byName = useMemo(() => new Map(products.map((p) => [norm(p.name), p])), [products]);
  useEffect(() => {
    if (hydrated || !products.length || !units.length) return;
    const bidonId = units.find((u) => u.symbol === "bidon")?.id;
    const cartonId = units.find((u) => u.symbol === "carton")?.id;
    const t = setTimeout(() => {
      setDraft((d) => ({
        ...d,
        lines: d.lines.map((l) => {
          const p = (l.productId ? products.find((x) => x.id === l.productId) : undefined) ?? byName.get(norm(composeName(l.name, num(l.liters) || null))) ?? byName.get(norm(l.name));
          const bidon = p?.unitConversions?.find((u) => u.fromUnitId === bidonId);
          const carton = p?.unitConversions?.find((u) => u.fromUnitId === cartonId);
          return {
            ...l,
            bidonPrice: l.retail && bidon?.sellingPrice ? String(Number(bidon.sellingPrice)) : l.bidonPrice,
            halfPrice: priceOfFraction(p, units, 0.5) ?? l.halfPrice,
            quarterPrice: priceOfFraction(p, units, 0.25) ?? l.quarterPrice,
            cartonSellingPrice: carton?.sellingPrice ? String(Number(carton.sellingPrice)) : l.cartonSellingPrice,
            perCarton: carton ? String(Number(carton.factor)) : l.perCarton,
          };
        }),
      }));
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
  }, [hydrated, products, units, byName]);
  const sugByName = useMemo(() => new Map(suggestions.map((s) => [norm(s.name), s])), [suggestions]);
  const supplier = suppliers.find((s) => s.id === draft.supplierId);
  const setField = (k: keyof Omit<ReceiptDraft, "lines">) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  // Changer le nom ou le format détache la ligne de l'article d'origine
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch, ...((patch.name !== undefined && patch.name !== l.name) || (patch.liters !== undefined && patch.liters !== l.liters) ? { productId: undefined } : {}) } : l)),
    }));

  // Choisir un nom (article existant ou suggestion) : pré-remplit ce qu'on connaît
  const pickName = (i: number, picked: string) => {
    const l = draft.lines[i];
    // On garde la marque/le produit ; le format (1 L, 4 L…) se choisit à part
    const sp = splitName(picked);
    const formats = products.filter((x) => norm(familyOf(x.name)) === norm(sp.family));
    const only = !sp.liters && formats.length === 1 ? formatLiters(formats[0].name) : null;
    const litres = sp.liters ?? only ?? (num(l.liters) || null);
    const name = sp.family;
    const p = byName.get(norm(composeName(name, litres))) ?? byName.get(norm(picked)) ?? null;
    const sug = sugByName.get(norm(picked)) ?? sugByName.get(norm(name));
    const cartonId = units.find((u) => u.symbol === "carton")?.id;
    const carton = p?.unitConversions?.find((u) => u.fromUnitId === cartonId);
    const bidonId = units.find((u) => u.symbol === "bidon")?.id;
    const litreId = units.find((u) => u.symbol === "L")?.id;
    const retailBidon = p && p.baseUnitId === litreId ? p.unitConversions?.find((u) => u.fromUnitId === bidonId) : undefined;
    setLine(i, {
      name,
      // Suggestion marquée « détail » (ex. VIGO, huile d'arachide) : vente au litre cochée d'office
      retail: l.retail || (!p && sug?.category === "detail"),
      bidonPrice: l.bidonPrice || (retailBidon?.sellingPrice ? String(Number(retailBidon.sellingPrice)) : ""),
      halfPrice: l.halfPrice || priceOfFraction(p, units, 0.5) || "",
      quarterPrice: l.quarterPrice || priceOfFraction(p, units, 0.25) || "",
      buyMode: !p && sug?.category === "detail" ? "unit" : l.buyMode,
      liters: litres ? String(litres) : l.liters || (sug?.liters ? String(sug.liters) : ""),
      perCarton: l.perCarton || (carton ? String(Number(carton.factor)) : sug?.unitsPerCarton ? String(sug.unitsPerCarton) : ""),
      sellingPrice: l.sellingPrice || (p ? String(Number(p.sellingPrice)) : ""),
      cartonSellingPrice: l.cartonSellingPrice || (carton?.sellingPrice ? String(Number(carton.sellingPrice)) : ""),
    });
    setFocus(null);
  };

  const litreUnit = units.find((u) => u.symbol === "L");
  const bidonUnit = units.find((u) => u.symbol === "bidon");
  const rows = draft.lines.map((l) => {
    const sp = splitName(l.name);
    const fam = sp.family;
    const wantL = num(l.liters) || sp.liters || null;
    const sameFamily = l.name.trim() ? products.filter((x) => norm(familyOf(x.name)) === norm(fam)) : [];
    const pinned = l.productId ? products.find((x) => x.id === l.productId) : undefined;
    const product =
      pinned ??
      (l.name.trim()
        ? (byName.get(norm(composeName(fam, wantL))) ??
          (wantL ? sameFamily.find((x) => formatLiters(x.name) === wantL) : byName.get(norm(l.name))))
        : null) ?? null;
    // Détail : article compté en litres (bidon = conditionnement de N litres)
    const retailBidon = product && litreUnit && product.baseUnitId === litreUnit.id ? product.unitConversions?.find((u) => u.fromUnitId === bidonUnit?.id) : undefined;
    const retail = product ? !!(litreUnit && product.baseUnitId === litreUnit.id) : !!l.retail;
    const byCarton = l.buyMode === "carton";
    const cartons = num(l.cartons);
    const perCarton = num(l.perCarton);
    const qty = byCarton ? cartons * perCarton : num(l.quantity);
    const lot = byCarton ? cartons * num(l.cartonPrice) : num(l.lotPrice);
    const sell = num(l.sellingPrice);
    const liters = retailBidon ? Number(retailBidon.factor) : (wantL ?? (product ? (formatLiters(product.name) ?? litersFromName(product.name)) : null));
    // Formats déjà en stock pour cette marque (choix rapide)
    const familyFormats = l.name.trim() ? products.filter((x) => norm(familyOf(x.name)) === norm(fam)) : [];
    const errors = {
      name: !l.name.trim() ? "Nom de l'article requis" : undefined,
      cartons: byCarton && !(cartons > 0) ? "Combien de cartons ?" : undefined,
      perCarton: byCarton && !(perCarton > 0) ? "Combien par carton ?" : undefined,
      cartonPrice: byCarton && !(num(l.cartonPrice) > 0) ? "Prix d'un carton requis" : undefined,
      quantity: !byCarton && !(qty > 0) ? "Combien ?" : undefined,
      lotPrice: !byCarton && !(lot > 0) ? "Prix total requis" : undefined,
      sellingPrice: !(sell > 0) ? "Prix de vente requis" : undefined,
      lotSize: !retail && l.lotPrice2 && !(num(l.lotSize) >= 2) ? "Combien dans le lot ?" : undefined,
      liters: retail && !(Number(liters) > 0) ? "Contenance du bidon requise (ex. 25)" : undefined,
    };
    const blank = !l.name.trim() && !l.cartons && !l.quantity && !l.cartonPrice && !l.lotPrice;
    return { l, fam, product, qty, lot, sell, liters, byCarton, perCarton, retail, retailBidon, familyFormats, errors, ok: !Object.values(errors).some(Boolean), blank };
  });
  const filled = rows.filter((r) => !r.blank);
  const goods = filled.reduce((s, r) => s + r.lot, 0);
  const fees = num(draft.transportCost) + num(draft.handlingCost);
  const payErr = !draft.paymentMode
    ? "Cochez « Déjà payé » ou « Pris à crédit »"
    : draft.paymentMode === "CREDIT" && !draft.supplierId
      ? "Pris à crédit : choisissez le fournisseur à qui on doit l'argent"
      : undefined;
  const canSave = online && filled.length > 0 && filled.every((r) => r.ok) && !payErr;

  const addSupplier = async () => {
    if (!newSupplier?.name.trim()) return;
    try {
      const { phone, otherPhones } = phonesPayload(newSupplier.phones);
      const res = await apiSend<{ data: Supplier }>("/api/suppliers", { name: newSupplier.name.trim(), phone: phone || undefined, otherPhones });
      setSuppliers((s) => [...s, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft((d) => ({ ...d, supplierId: res.data.id }));
      setNewSupplier(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const savePhone = async () => {
    if (!supplier || phoneEdit === null) return;
    try {
      const body = phonesPayload(phoneEdit);
      await apiSend(`/api/suppliers/${supplier.id}`, body, "PATCH");
      setSuppliers((list) => list.map((s) => (s.id === supplier.id ? { ...s, ...body } : s)));
      setPhoneEdit(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  /** Unité « Lot de N » (créée au besoin). */
  const lotUnit = async (n: number): Promise<string> => {
    const symbol = `lot${n}`;
    const found = units.find((u) => u.symbol === symbol);
    if (found) return found.id;
    const created = await apiSend<{ data: Unit }>("/api/units", { name: `Lot de ${n}`, symbol, kind: "PACKAGING" });
    setUnits((u) => [...u, created.data]);
    return created.data.id;
  };

  const save = async () => {
    setTried(true);
    if (!canSave) return;
    // Prix de vente sous le prix d'achat : on prévient avant d'enregistrer
    const losses = filled.filter((r) => {
      const cost = r.qty > 0 && r.lot > 0 ? r.lot / r.qty : 0;
      const floor = r.retail ? (Number(r.liters) > 0 ? ceil25(cost / Number(r.liters)) : 0) : ceil25(cost);
      return floor > 0 && r.sell > 0 && r.sell < floor;
    });
    if (losses.length && !window.confirm(`Vente à perte : le prix de vente de ${losses.map((r) => r.l.name).join(", ")} est sous le prix d'achat. Enregistrer quand même ?`)) return;
    setBusy(true);
    setError(null);
    try {
      const bidon = units.find((u) => u.symbol === "bidon") ?? units[0];
      const carton = units.find((u) => u.symbol === "carton");
      const lines: Array<{ productId: string; quantity: number; unitPrice: number; totalPrice: number }> = [];
      // Prix baissé sur un article qui a encore du stock : proposé à la direction avec l'arrivage
      // (si le prix d'achat a baissé, l'ancien stock garde son prix et le patron choisit)
      const proposedPrices: Record<string, { price: number; packagings?: Array<{ unitId: string; price: number }> }> = {};
      const hasStock = (p: ProductFull | null) => (p?.stocks ?? []).some((s) => Number(s.quantity) > 0);
      const lowering = (p: ProductFull | null, sell: number) => !editId && !!p && hasStock(p) && sell < Number(p.sellingPrice);
      for (const r of filled) {
        if (r.retail) {
          // Vente au détail : stock en litres, prix du litre (½ et ¼ calculés à la caisse), bidon entier
          if (!litreUnit || !bidonUnit) throw new Error("Unités « Litre » et « Bidon » introuvables");
          const L = Number(r.liters);
          const litres = r.qty * L;
          const costL = Math.round((r.lot / litres) * 100) / 100;
          const bidonSell = num(r.l.bidonPrice ?? "") > 0 ? num(r.l.bidonPrice ?? "") : Math.round(r.sell * L);
          const pk: Array<{ unitId: string; factor: number; sellingPrice: number }> = [{ unitId: bidonUnit.id, factor: L, sellingPrice: bidonSell }];
          // ½ L et ¼ L à leur propre prix (s'ils sont remplis ou existaient déjà)
          const halfSell = num(r.l.halfPrice ?? "");
          const quarterSell = num(r.l.quarterPrice ?? "");
          const fu = halfSell > 0 || quarterSell > 0 ? await fractionUnits(units) : null;
          if (fu && halfSell > 0) pk.push({ unitId: fu.half, factor: 0.5, sellingPrice: halfSell });
          if (fu && quarterSell > 0) pk.push({ unitId: fu.quarter, factor: 0.25, sellingPrice: quarterSell });
          const fractionChanged =
            (halfSell > 0 && priceOfFraction(r.product, units, 0.5) !== String(halfSell)) || (quarterSell > 0 && priceOfFraction(r.product, units, 0.25) !== String(quarterSell));
          let rid = r.product?.id;
          if (!rid) {
            const created = await apiSend<{ data: { id: string } }>("/api/products", {
              name: composeName(r.fam, L),
              centerId,
              baseUnitId: litreUnit.id,
              purchasePrice: costL,
              sellingPrice: r.sell,
              stockAlertQty: 7,
              attributes: { contenance: fmtL(L), détail: "litre, ½ L, ¼ L" },
              packagings: pk,
            });
            rid = created.data.id;
          } else if (canPrice && lowering(r.product, r.sell)) {
            proposedPrices[rid] = { price: r.sell, packagings: pk.map((x) => ({ unitId: x.unitId, price: x.sellingPrice })) };
          } else if (canPrice && (Number(r.product!.sellingPrice) !== r.sell || Number(r.retailBidon?.sellingPrice ?? 0) !== bidonSell || fractionChanged)) {
            const replaced = new Set(pk.map((x) => x.unitId));
            const keep = (r.product!.unitConversions ?? [])
              .filter((u) => !replaced.has(u.fromUnitId))
              .map((u) => ({ unitId: u.fromUnitId, factor: Number(u.factor), sellingPrice: u.sellingPrice != null ? Number(u.sellingPrice) : null, barcode: u.barcode }));
            await apiSend(`/api/products/${rid}`, { sellingPrice: r.sell, packagings: [...keep, ...pk] }, "PATCH");
          }
          lines.push({ productId: rid, quantity: litres, unitPrice: costL, totalPrice: Math.round(r.lot) });
          continue;
        }
        const cost = Math.round((r.lot / r.qty) * 100) / 100;
        // Prix de vente du carton et du lot : conditionnements de l'article
        const packagings: Array<{ unitId: string; factor: number; sellingPrice: number }> = [];
        if (carton && r.perCarton > 0 && num(r.l.cartonSellingPrice) > 0) packagings.push({ unitId: carton.id, factor: r.perCarton, sellingPrice: num(r.l.cartonSellingPrice) });
        if (num(r.l.lotPrice2) > 0 && num(r.l.lotSize) >= 2) packagings.push({ unitId: await lotUnit(num(r.l.lotSize)), factor: num(r.l.lotSize), sellingPrice: num(r.l.lotPrice2) });
        let id = r.product?.id;
        if (!id) {
          if (!bidon) throw new Error("Aucune unité disponible pour créer l'article");
          const litres = Number(r.liters) || 0;
          // « SHELL HELIX — 4 L » ; filtres, colles… : le nom seul
          const name = composeName(r.fam, litres);
          const created = await apiSend<{ data: { id: string } }>("/api/products", {
            name,
            centerId,
            baseUnitId: bidon.id,
            purchasePrice: cost,
            sellingPrice: r.sell,
            stockAlertQty: 7,
            ...(litres > 0 ? { attributes: { contenance: fmtL(litres) } } : {}),
            ...(packagings.length ? { packagings } : {}),
          });
          id = created.data.id;
        } else {
          // Prix de vente revus avant l'enregistrement : on garde les autres conditionnements
          const keep = (r.product!.unitConversions ?? [])
            .filter((u) => !packagings.some((p) => p.unitId === u.fromUnitId))
            .map((u) => ({ unitId: u.fromUnitId, factor: Number(u.factor), sellingPrice: u.sellingPrice != null ? Number(u.sellingPrice) : null, barcode: u.barcode }));
          const priceChanged = Number(r.product!.sellingPrice) !== r.sell;
          if (canPrice && lowering(r.product, r.sell)) {
            proposedPrices[id] = { price: r.sell, packagings: packagings.map((x) => ({ unitId: x.unitId, price: x.sellingPrice })) };
          } else if (canPrice && (priceChanged || packagings.length)) {
            await apiSend(`/api/products/${id}`, { sellingPrice: r.sell, ...(packagings.length ? { packagings: [...keep, ...packagings] } : {}) }, "PATCH");
          }
        }
        lines.push({ productId: id, quantity: r.qty, unitPrice: cost, totalPrice: Math.round(r.lot) });
      }
      const body = {
        centerId,
        supplierId: draft.supplierId || undefined,
        reference: draft.reference || undefined,
        receivedAt: draft.receivedAt,
        transportCost: num(draft.transportCost),
        handlingCost: num(draft.handlingCost),
        lines,
        payment: {
          mode: draft.paymentMode,
          ...(draft.paymentMode === "PAID" ? { method: draft.paymentMethod || "CASH" } : {}),
          ...(draft.paymentMode === "CREDIT" && draft.dueDate ? { dueDate: draft.dueDate } : {}),
        },
      };
      if (editId) {
        // Le stock est corrigé de la différence, l'historique garde tout
        await apiSend(`/api/goods-receipts/${editId}`, body, "PUT");
      } else {
        const res = await apiSend<{ data: { id: string } }>("/api/goods-receipts", body);
        const v = await apiSend<{ message?: string; data?: { priceDecisions?: string[] } }>(`/api/goods-receipts/${res.data.id}/validate`, { payment: body.payment, proposedPrices });
        if (v.data?.priceDecisions?.length) {
          window.alert(
            "Le prix d'achat a baissé. L'ancien stock garde son prix de vente. Le patron a reçu une notification pour choisir le prix du nouveau stock."
          );
        }
      }
      await autosave.clear();
      await onSaved();
    } catch (e) {
      setError(errorMessage(e)); // le brouillon local est conservé
      loadProducts(); // les articles déjà créés sont repris par leur nom au prochain essai
    } finally {
      setBusy(false);
    }
  };

  const err = (msg?: string) => (tried ? msg : undefined);
  const names = useMemo(() => {
    // Une ligne par marque/produit (les formats se choisissent ensuite)
    const all = new Map<string, { name: string; kind: "stock" | "suggestion" }>();
    for (const p of products) all.set(norm(familyOf(p.name)), { name: familyOf(p.name), kind: "stock" });
    for (const s of suggestions) {
      const f = splitName(s.name).family;
      if (!all.has(norm(f))) all.set(norm(f), { name: f, kind: "suggestion" });
    }
    return [...all.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "fr") : a.kind === "stock" ? -1 : 1));
  }, [products, suggestions]);

  return (
    <Card className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">{editId ? "Modifier l'arrivage" : "Nouvel arrivage"}</h2>
        <span className="text-xs text-gray-500">
          {autosave.status === "saved" && autosave.savedAt && `Brouillon gardé sur cet appareil (${autosave.savedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })})`}
          {autosave.status === "error" && <span className="text-red-600">Sauvegarde locale impossible</span>}
        </span>
      </div>

      {editId && (
        <Alert tone="blue">Changez ce que vous voulez : fournisseur, articles, format, quantités, prix. En enregistrant, le stock est corrigé de la différence et la modification est notée dans l&apos;historique.</Alert>
      )}
      {!editId && autosave.restored && (
        <Alert tone="blue">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Un arrivage non terminé a été retrouvé ({new Date(autosave.restored.updatedAt).toLocaleString("fr-FR")}).</span>
            <span className="flex gap-2">
              <Button
                className="px-3 py-1.5"
                onClick={() => {
                  setDraft(autosave.restored!.data as ReceiptDraft);
                  autosave.dismissRestored();
                }}
              >
                Reprendre
              </Button>
              <Button variant="secondary" className="px-3 py-1.5" onClick={async () => await autosave.clear()}>
                Ignorer
              </Button>
            </span>
          </div>
        </Alert>
      )}
      {!online && <Alert tone="amber">Hors connexion : la saisie est gardée sur cet appareil. Enregistrez au retour du réseau.</Alert>}
      {error && <Alert>{error}</Alert>}

      {/* 1. Fournisseur */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">1. Fournisseur</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Fournisseur">
            <Select
              value={draft.supplierId}
              onChange={(e) => {
                setField("supplierId")(e);
                // Fournisseur choisi : on passe directement au premier produit, liste ouverte
                if (e.target.value) setTimeout(() => document.querySelector<HTMLInputElement>("[data-product-name]")?.focus(), 50);
              }}
            >
              <option value="">— Choisir —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Référence (n° du bon ou de la facture)">
            <Input value={draft.reference} onChange={setField("reference")} placeholder="ex. BL-0412" />
          </Field>
          <Field label="Date d'arrivée">
            <Input type="date" value={draft.receivedAt} onChange={setField("receivedAt")} />
          </Field>
        </div>
        {supplier &&
          (phoneEdit !== null ? (
            <div className="space-y-2 rounded-xl bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-700">Numéros de {supplier.name}</p>
              <PhonesInput value={phoneEdit} onChange={setPhoneEdit} />
              <div className="flex gap-2">
                <Button variant="secondary" disabled={!online} onClick={() => void savePhone()}>
                  Enregistrer
                </Button>
                <Button variant="ghost" onClick={() => setPhoneEdit(null)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              📞 {phonesOf(supplier).length > 1 ? "Numéros" : "Contact"} du fournisseur :{" "}
              {phonesOf(supplier).length ? <strong>{phonesOf(supplier).join(" / ")}</strong> : <span className="text-gray-400">non renseigné</span>}{" "}
              <button className="ml-1 text-blue-600 hover:underline" onClick={() => setPhoneEdit(phonesOf(supplier).length ? phonesOf(supplier) : [""])}>
                {phonesOf(supplier).length ? "Modifier / ajouter un numéro" : "Ajouter"}
              </button>
            </p>
          ))}
        {newSupplier ? (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-start rounded-xl bg-gray-50 p-3">
            <Field label="Nom du nouveau fournisseur">
              <Input value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} placeholder="ex. Distrilub Cotonou" />
            </Field>
            <Field label="Téléphones" hint="Servent dans les alertes de stock">
              <PhonesInput value={newSupplier.phones} onChange={(phones) => setNewSupplier({ ...newSupplier, phones })} />
            </Field>
            <div className="flex gap-2 sm:pt-6">
              <Button variant="secondary" onClick={addSupplier} disabled={!newSupplier.name.trim() || !online}>
                Ajouter
              </Button>
              <Button variant="ghost" onClick={() => setNewSupplier(null)}>
                ✕
              </Button>
            </div>
          </div>
        ) : (
          <button className="text-sm text-blue-600 hover:underline" onClick={() => setNewSupplier({ name: "", phones: [""] })}>
            + Nouveau fournisseur
          </button>
        )}
      </section>

      {/* 2. Articles */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">2. Articles reçus</h3>
        {rows.map((r, i) => {
          const word = r.retail ? "bidons" : unitWord(r.product?.baseUnit.symbol);
          const one = r.product?.baseUnit.symbol === "btl" ? "bouteille" : word === "seaux" ? "seau" : word.replace(/s$/, "");
          const costPer = r.qty > 0 && r.lot > 0 ? r.lot / r.qty : 0;
          // Prix d'achat unitaire arrondi au 25 F supérieur : c'est le prix plancher de vente
          const litres = Number(r.liters) > 0 ? Number(r.liters) : 0;
          const floor = r.retail ? (litres > 0 ? ceil25(costPer / litres) : 0) : ceil25(costPer);
          const belowFloor = floor > 0 && r.sell > 0 && r.sell < floor;
          const stock = r.product?.stocks?.[0] ? Number(r.product.stocks[0].quantity) : null;
          const typed = norm(r.l.name);
          // Un clic dans le champ ouvre toute la liste des produits ; taper la filtre (abréviations comprises)
          const matches =
            focus !== i || (r.l.fresh && !typed)
              ? []
              : names.filter((n) => (!typed || matchesSearch(n.name, typed)) && norm(n.name) !== typed).slice(0, 80);
          return (
            <div key={i} className="rounded-xl border border-gray-200 p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{r.l.fresh && !r.product ? `Nouveau produit (article ${i + 1})` : `Article ${i + 1}`}</span>
                <span className="flex items-center gap-3">
                  {r.l.name.trim() && (r.product ? <Badge tone="green">Déjà en stock</Badge> : r.familyFormats.length ? <Badge tone="blue">Nouveau format</Badge> : <Badge tone="blue">Nouvel article</Badge>)}
                  {draft.lines.length > 1 && (
                    <button className="text-sm text-red-600 hover:underline" onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}>
                      Retirer
                    </button>
                  )}
                </span>
              </div>

              {r.l.fresh && !r.product && (
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  Produit jamais vendu à la boutique : donnez-lui un nom, sa contenance, son prix d’achat et ses prix de vente. Il sera ajouté à la liste des articles et à la caisse dès l’enregistrement.
                </p>
              )}
              <div className="relative">
                <Field
                  label={r.l.fresh && !r.product ? "Nom du nouveau produit" : "Nom de l'article"}
                  error={err(r.errors.name)}
                  hint={r.product ? `En stock : ${stock ?? 0} ${word}${r.liters ? ` · ${fmtL(r.liters)} par ${one}` : ""}` : "Touchez le champ pour choisir dans la liste, ou tapez quelques lettres"}
                >
                  <Input
                    value={r.l.name}
                    data-product-name={i === 0 ? "" : undefined}
                    placeholder={r.l.fresh ? "ex. Huile moto Oryx" : "Choisir un produit…"}
                    autoComplete="off"
                    onFocus={() => setFocus(i)}
                    onBlur={() => setTimeout(() => setFocus((f) => (f === i ? null : f)), 150)}
                    onChange={(e) => {
                      setLine(i, { name: e.target.value });
                      setFocus(i);
                    }}
                  />
                </Field>
                {matches.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                    {matches.map((m) => (
                      <li key={m.name}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickName(i, m.name)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50"
                        >
                          <span>{m.name}</span>
                          <span className="text-xs text-gray-400">{m.kind === "stock" ? "en stock" : "suggestion"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {r.l.name.trim() && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-gray-500">Bidon de :</span>
                  {[...new Set([...r.familyFormats.map((x) => formatLiters(x.name)).filter((x): x is number => !!x), ...COMMON_FORMATS])].map((f) => {
                    const has = r.familyFormats.some((x) => formatLiters(x.name) === f);
                    const on = Number(r.liters) === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setLine(i, { liters: String(f) })}
                        className={`rounded-lg border px-2.5 py-1 text-sm ${on ? "border-blue-600 bg-blue-50 font-semibold text-blue-800" : has ? "border-green-300 bg-green-50 text-green-800" : "border-gray-300 text-gray-700"}`}
                      >
                        {f === 0.25 ? "¼ L" : f === 0.5 ? "½ L" : fmtL(f)}
                        {has && " ✓"}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Format du bidon (litres)" hint="Vide pour un filtre, une colle…">
                  <Input inputMode="decimal" value={r.l.liters} onChange={(e) => setLine(i, { liters: e.target.value })} placeholder="ex. 1" />
                </Field>
                {!r.product && (
                  <label className="col-span-2 flex items-center gap-2 self-end rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    <input type="checkbox" checked={!!r.l.retail} onChange={(e) => setLine(i, { retail: e.target.checked, buyMode: e.target.checked ? "unit" : r.l.buyMode })} />
                    Vendu aussi au détail (litre, ½ L, ¼ L)
                  </label>
                )}
                {r.product && r.retail && (
                  <p className="col-span-2 self-end rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">Vendu au détail : stock compté en litres</p>
                )}
                <Field label="Acheté">
                  <Select value={r.l.buyMode} onChange={(e) => setLine(i, { buyMode: e.target.value as DraftLine["buyMode"] })}>
                    <option value="carton">Au carton</option>
                    <option value="unit">À l&apos;unité / en vrac</option>
                  </Select>
                </Field>
              </div>

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Achat</p>
              {r.byCarton ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Field label="Nombre de cartons" error={err(r.errors.cartons)}>
                    <Input inputMode="numeric" value={r.l.cartons} onChange={(e) => setLine(i, { cartons: e.target.value })} placeholder="ex. 5" />
                  </Field>
                  <Field label={`${word[0].toUpperCase()}${word.slice(1)} par carton`} error={err(r.errors.perCarton)}>
                    <Input inputMode="numeric" value={r.l.perCarton} onChange={(e) => setLine(i, { perCarton: e.target.value })} placeholder="ex. 12" />
                  </Field>
                  <Field label="Prix d'un carton (achat)" error={err(r.errors.cartonPrice)}>
                    <Input inputMode="numeric" value={r.l.cartonPrice} onChange={(e) => setLine(i, { cartonPrice: e.target.value })} placeholder="ex. 30 000" />
                  </Field>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Nombre de ${word}`} error={err(r.errors.quantity)}>
                    <Input inputMode="numeric" value={r.l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="ex. 30" />
                  </Field>
                  <Field label="Prix total payé" error={err(r.errors.lotPrice)}>
                    <Input inputMode="numeric" value={r.l.lotPrice} onChange={(e) => setLine(i, { lotPrice: e.target.value })} placeholder="ex. 28 200" />
                  </Field>
                </div>
              )}
              {r.retail && r.errors.liters && tried && <p className="text-sm text-red-600">{r.errors.liters}</p>}
              {r.qty > 0 && (
                <p className="text-sm text-gray-600">
                  Total reçu : <strong>{r.qty.toLocaleString("fr-FR")} {word}</strong>
                  {r.retail && Number(r.liters) > 0 && <> = <strong>{(r.qty * Number(r.liters)).toLocaleString("fr-FR")} litres</strong> en stock</>}
                  {r.lot > 0 && (
                    <>
                      {" "}pour <Money value={r.lot} currency={currency} /> · revient à <strong><Money value={costPer} currency={currency} /></strong> le {one}
                    </>
                  )}
                </p>
              )}

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Prix de vente</p>
              {r.product && !canPrice && <p className="text-xs text-gray-500">Prix fixés par la direction : seuls la direction et le gérant peuvent les changer.</p>}
              {r.retail ? (
                <>
                  <fieldset disabled={!!r.product && !canPrice} className="grid grid-cols-2 gap-3 disabled:opacity-60">
                    <Field label="Prix du litre" error={err(r.errors.sellingPrice) ?? (belowFloor ? "Vente à perte !" : undefined)}>
                      <Input inputMode="numeric" value={r.l.sellingPrice} onChange={(e) => setLine(i, { sellingPrice: e.target.value })} placeholder="ex. 1 500" />
                    </Field>
                    <Field label={Number(r.liters) > 0 ? `Le bidon entier (${fmtL(Number(r.liters))})` : "Le bidon entier"} hint="Vide : litres × prix du litre">
                      <Input
                        inputMode="numeric"
                        value={r.l.bidonPrice ?? ""}
                        onChange={(e) => setLine(i, { bidonPrice: e.target.value })}
                        placeholder={r.sell > 0 && Number(r.liters) > 0 ? (r.sell * Number(r.liters)).toLocaleString("fr-FR") : "ex. 35 000"}
                      />
                    </Field>
                    <Field label="Prix du ½ litre" hint="Facultatif · vide : litre ÷ 2">
                      <Input inputMode="numeric" value={r.l.halfPrice ?? ""} onChange={(e) => setLine(i, { halfPrice: e.target.value })} placeholder={r.sell > 0 ? (r.sell / 2).toLocaleString("fr-FR") : "ex. 800"} />
                    </Field>
                    <Field label="Prix du ¼ litre" hint="Facultatif · vide : litre ÷ 4">
                      <Input inputMode="numeric" value={r.l.quarterPrice ?? ""} onChange={(e) => setLine(i, { quarterPrice: e.target.value })} placeholder={r.sell > 0 ? (r.sell / 4).toLocaleString("fr-FR") : "ex. 400"} />
                    </Field>
                  </fieldset>
                  {r.sell > 0 && (
                    <p className="text-sm text-gray-700">
                      À la caisse : 1 L = <strong><Money value={r.sell} currency={currency} /></strong> · ½ L = <strong><Money value={num(r.l.halfPrice ?? "") > 0 ? num(r.l.halfPrice ?? "") : r.sell / 2} currency={currency} /></strong> · ¼ L ={" "}
                      <strong><Money value={num(r.l.quarterPrice ?? "") > 0 ? num(r.l.quarterPrice ?? "") : r.sell / 4} currency={currency} /></strong>
                    </p>
                  )}
                  {floor > 0 && <FloorPrice floor={floor} sell={r.sell} per="litre" bidon={litres > 0 ? ceil25(costPer) : 0} currency={currency} />}
                </>
              ) : (
              <>
              <fieldset disabled={!!r.product && !canPrice} className="grid grid-cols-2 sm:grid-cols-4 gap-3 disabled:opacity-60">
                <Field label={`1 ${one}`} error={err(r.errors.sellingPrice) ?? (belowFloor ? "Vente à perte !" : undefined)}>
                  <Input inputMode="numeric" value={r.l.sellingPrice} onChange={(e) => setLine(i, { sellingPrice: e.target.value })} placeholder="ex. 3 500" />
                </Field>
                <Field label={r.perCarton > 0 ? `Le carton (${r.perCarton})` : "Le carton"} hint="Facultatif">
                  <Input inputMode="numeric" value={r.l.cartonSellingPrice} onChange={(e) => setLine(i, { cartonSellingPrice: e.target.value })} disabled={!(r.perCarton > 0)} placeholder={r.perCarton > 0 ? "ex. 40 000" : "indiquez le nb par carton"} />
                </Field>
                <Field label="Lot de…" error={err(r.errors.lotSize)} hint="Facultatif">
                  <Input inputMode="numeric" value={r.l.lotSize} onChange={(e) => setLine(i, { lotSize: e.target.value })} placeholder="ex. 3" />
                </Field>
                <Field label={num(r.l.lotSize) >= 2 ? `Prix du lot de ${num(r.l.lotSize)}` : "Prix du lot"} hint="Facultatif">
                  <Input inputMode="numeric" value={r.l.lotPrice2} onChange={(e) => setLine(i, { lotPrice2: e.target.value })} placeholder="ex. 10 000" />
                </Field>
              </fieldset>
              {floor > 0 && <FloorPrice floor={floor} sell={r.sell} per={one} currency={currency} />}
              </>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))}>
            + Ajouter un autre article
          </Button>
          <Button variant="secondary" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine(true)] }))}>
            ✨ Ajouter un nouveau produit
          </Button>
        </div>
      </section>

      {/* 3. Frais (facultatif) */}
      {showFees || fees > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Transport (facultatif)">
            <Input inputMode="numeric" value={draft.transportCost} onChange={setField("transportCost")} />
          </Field>
          <Field label="Manutention (facultatif)">
            <Input inputMode="numeric" value={draft.handlingCost} onChange={setField("handlingCost")} />
          </Field>
        </div>
      ) : (
        <button className="text-sm text-blue-600 hover:underline" onClick={() => setShowFees(true)}>
          + Frais de transport ou de manutention
        </button>
      )}

      {/* 4. Règlement : déjà payé ou à crédit */}
      <section className={`space-y-3 rounded-xl border p-3 ${tried && payErr ? "border-red-300 bg-red-50" : "border-gray-200"}`}>
        <p className="text-sm font-semibold text-gray-900">La marchandise est…</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              ["PAID", "✅ Déjà payée", "Le fournisseur est réglé : rien à rappeler."],
              ["CREDIT", "🕒 Prise à crédit", "À régler plus tard : la direction recevra un rappel."],
            ] as const
          ).map(([v, label, hint]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${draft.paymentMode === v ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"}`}>
              <input type="radio" name="paymentMode" className="mt-1" checked={draft.paymentMode === v} onChange={() => setDraft((d) => ({ ...d, paymentMode: v }))} />
              <span>
                <span className="font-semibold">{label}</span>
                <span className="block text-xs text-gray-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {draft.paymentMode === "PAID" && (
          <Field label="Payée comment ?">
            <Select value={draft.paymentMethod || "CASH"} onChange={(e) => setDraft((d) => ({ ...d, paymentMethod: e.target.value }))}>
              <option value="CASH">Espèces</option>
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="TRANSFER">Virement</option>
              <option value="CARD">Carte</option>
            </Select>
          </Field>
        )}
        {draft.paymentMode === "CREDIT" && (
          <Field label="À payer avant le (facultatif)" hint="Vide : selon le délai du fournisseur. Rappel 2 jours avant, puis chaque jour en cas de retard.">
            <Input type="date" value={draft.dueDate ?? ""} onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} />
          </Field>
        )}
        {tried && payErr && <p className="text-sm font-medium text-red-700">{payErr}</p>}
      </section>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <p className="text-sm text-gray-700">
          {draft.paymentMode === "CREDIT" ? "Total à payer" : "Total payé"} : <strong><Money value={goods + fees} currency={currency} /></strong>
          {fees > 0 && <span className="text-gray-500"> (dont frais <Money value={fees} currency={currency} />)</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Fermer
          </Button>
          <Button variant="success" onClick={save} loading={busy} disabled={!online || busy}>
            {editId ? "Enregistrer les modifications" : "Enregistrer l'arrivage"}
          </Button>
        </div>
      </div>
      {tried && !canSave && filled.length > 0 && <Alert tone="amber">Complétez les champs en rouge pour enregistrer.</Alert>}
      {tried && filled.length === 0 && <Alert tone="amber">Ajoutez au moins un article.</Alert>}
    </Card>
  );
}

/** Arrondi au 25 F supérieur : 1 119 → 1 125, 1 137 → 1 150, 1 180 → 1 200 (1 100 reste 1 100). */
function ceil25(n: number): number {
  return n > 0 ? Math.ceil(Math.round(n * 100) / 100 / 25) * 25 : 0;
}

/** Prix d'achat unitaire (arrondi) = on ne vend pas en dessous. */
function FloorPrice({ floor, sell, per, bidon, currency }: { floor: number; sell: number; per: string; bidon?: number; currency: string }) {
  const loss = sell > 0 && sell < floor;
  const gain = sell > 0 ? sell - floor : 0;
  return (
    <div className={`rounded-xl border p-3 text-sm ${loss ? "border-red-300 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <p>
        Prix d&apos;achat unitaire : <strong><Money value={floor} currency={currency} /></strong> le {per}
        {bidon ? (
          <>
            {" "}(<Money value={bidon} currency={currency} /> le bidon)
          </>
        ) : null}
      </p>
      <p className="font-semibold">⛔ Ne pas vendre en dessous de <Money value={floor} currency={currency} /> le {per}.</p>
      {loss ? (
        <p className="mt-1 font-bold">⚠️ Vente à perte : {(floor - sell).toLocaleString("fr-FR")} F de perte par {per}.</p>
      ) : (
        sell > 0 && (
          <p className="mt-1 text-green-800">
            Bénéfice : <strong><Money value={gain} currency={currency} /></strong> par {per}.
          </p>
        )
      )}
    </div>
  );
}

/** Déjà payé / à crédit (reste à payer, échéance) sous le nom du fournisseur. */
function PayBadge({ r, now }: { r: Receipt; now: number }) {
  if (r.paymentMode === "PAID") return <span className="mt-0.5 block text-xs font-medium text-green-700">✅ Payé</span>;
  if (r.paymentMode !== "CREDIT" || !r.purchase) return null;
  const left = Number(r.purchase.totalAmount) - Number(r.purchase.paidAmount);
  if (left <= 0) return <span className="mt-0.5 block text-xs font-medium text-green-700">✅ Crédit soldé</span>;
  const late = r.purchase.dueDate && new Date(r.purchase.dueDate).getTime() < now;
  return (
    <span className={`mt-0.5 block text-xs font-medium ${late ? "text-red-700" : "text-amber-700"}`}>
      🕒 À crédit : {left.toLocaleString("fr-FR")} F à payer
      {r.purchase.dueDate ? ` ${late ? "— en retard depuis le" : "avant le"} ${new Date(r.purchase.dueDate).toLocaleDateString("fr-FR")}` : ""}
    </span>
  );
}
