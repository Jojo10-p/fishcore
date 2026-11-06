"use client";

import { matchesSearch } from "@/lib/search-aliases";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { useOnline } from "@/components/app/connection-badge";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Money, PageHeader, Qty, Select, Spinner, Table, Td } from "@/components/ui";
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
}
interface ReceiptDraft {
  supplierId: string;
  reference: string;
  receivedAt: string;
  transportCost: string;
  handlingCost: string;
  lines: DraftLine[];
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
});
const num = (v: string) => Number((v || "0").replace(",", "."));

export default function ReceptionsPage() {
  const { centerId, currency, can } = useSession();
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
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
          !creating && (
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
      <Card>
        {!receipts ? (
          <Spinner />
        ) : receipts.length === 0 ? (
          <EmptyState icon="🚚" title="Aucun arrivage enregistré" />
        ) : (
          <Table head={["Date", "Fournisseur", "Articles reçus", "Coût total", "Statut", ""]}>
            {receipts.map((r) => {
              const goods = r.lines.reduce((s, l) => s + Number(l.totalPrice), 0);
              const fees = num(r.transportCost) + num(r.iceCost) + num(r.handlingCost) + num(r.otherCosts);
              return (
                <tr key={r.id}>
                  <Td>
                    {new Date(r.receivedAt).toLocaleDateString("fr-FR")}
                    {r.reference && <p className="text-xs text-gray-500">{r.reference}</p>}
                  </Td>
                  <Td>{r.supplier?.name ?? "—"}</Td>
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
                    {!r.isValidated && can("stock:receive") && (
                      <Button variant="success" className="px-3 py-1.5" loading={validating === r.id} onClick={() => validate(r.id)}>
                        Valider
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
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
const fmtL = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} L`;

interface Suggestion {
  id: string;
  name: string;
  liters: number | null;
  unitsPerCarton: number | null;
}
interface ProductFull extends ProductOption {
  baseUnitId: string;
  unitConversions?: Array<{ fromUnitId: string; factor: string; sellingPrice: string | null; barcode: string | null }>;
}

function ReceiptForm({
  centerId,
  currency,
  startNew = false,
  onCancel,
  onSaved,
}: {
  centerId: string;
  currency: string;
  startNew?: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const online = useOnline();
  const { can } = useSession();
  // Prix d'un article déjà en stock : seuls la direction et le gérant les changent
  const canPrice = can("product:price");
  const [draft, setDraft] = useState<ReceiptDraft>(() => emptyDraft(startNew));
  const [products, setProducts] = useState<ProductFull[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suppliers, setSuppliers] = useState<Array<Supplier & { phone?: string | null }>>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [newSupplier, setNewSupplier] = useState<{ name: string; phone: string } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [showFees, setShowFees] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const touched = useMemo(() => draft.supplierId !== "" || draft.reference !== "" || draft.lines.some((l) => l.name || l.quantity || l.lotPrice), [draft]);
  const autosave = useAutosaveDraft(`goods-receipt:v4:${centerId}`, draft, { enabled: touched });

  const loadProducts = useCallback(() => {
    apiGet<{ data: ProductFull[] }>(`/api/products?centerId=${centerId}`).then((r) => setProducts(r.data)).catch(() => undefined);
  }, [centerId]);
  useEffect(() => {
    loadProducts();
    apiGet<{ data: Array<Supplier & { phone?: string | null }> }>("/api/suppliers").then((r) => setSuppliers(r.data)).catch(() => undefined);
    apiGet<{ data: Unit[] }>("/api/units").then((r) => setUnits(r.data)).catch(() => undefined);
    apiGet<{ data: Suggestion[] }>("/api/product-suggestions").then((r) => setSuggestions(r.data)).catch(() => undefined);
  }, [loadProducts]);

  const byName = useMemo(() => new Map(products.map((p) => [norm(p.name), p])), [products]);
  const sugByName = useMemo(() => new Map(suggestions.map((s) => [norm(s.name), s])), [suggestions]);
  const supplier = suppliers.find((s) => s.id === draft.supplierId);
  const setField = (k: keyof Omit<ReceiptDraft, "lines">) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const setLine = (i: number, patch: Partial<DraftLine>) => setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  // Choisir un nom (article existant ou suggestion) : pré-remplit ce qu'on connaît
  const pickName = (i: number, name: string) => {
    const p = byName.get(norm(name));
    const sug = sugByName.get(norm(name));
    const l = draft.lines[i];
    const cartonId = units.find((u) => u.symbol === "carton")?.id;
    const carton = p?.unitConversions?.find((u) => u.fromUnitId === cartonId);
    setLine(i, {
      name,
      liters: l.liters || (sug?.liters ? String(sug.liters) : ""),
      perCarton: l.perCarton || (carton ? String(Number(carton.factor)) : sug?.unitsPerCarton ? String(sug.unitsPerCarton) : ""),
      sellingPrice: l.sellingPrice || (p ? String(Number(p.sellingPrice)) : ""),
      cartonSellingPrice: l.cartonSellingPrice || (carton?.sellingPrice ? String(Number(carton.sellingPrice)) : ""),
    });
    setFocus(null);
  };

  const rows = draft.lines.map((l) => {
    const product = byName.get(norm(l.name)) ?? null;
    const byCarton = l.buyMode === "carton";
    const cartons = num(l.cartons);
    const perCarton = num(l.perCarton);
    const qty = byCarton ? cartons * perCarton : num(l.quantity);
    const lot = byCarton ? cartons * num(l.cartonPrice) : num(l.lotPrice);
    const sell = num(l.sellingPrice);
    const liters = product ? (litersFromName(product.name) ?? (num(l.liters) || null)) : num(l.liters) || null;
    const errors = {
      name: !l.name.trim() ? "Nom de l'article requis" : undefined,
      cartons: byCarton && !(cartons > 0) ? "Combien de cartons ?" : undefined,
      perCarton: byCarton && !(perCarton > 0) ? "Combien par carton ?" : undefined,
      cartonPrice: byCarton && !(num(l.cartonPrice) > 0) ? "Prix d'un carton requis" : undefined,
      quantity: !byCarton && !(qty > 0) ? "Combien ?" : undefined,
      lotPrice: !byCarton && !(lot > 0) ? "Prix total requis" : undefined,
      sellingPrice: !(sell > 0) ? "Prix de vente requis" : undefined,
      lotSize: l.lotPrice2 && !(num(l.lotSize) >= 2) ? "Combien dans le lot ?" : undefined,
    };
    const blank = !l.name.trim() && !l.cartons && !l.quantity && !l.cartonPrice && !l.lotPrice;
    return { l, product, qty, lot, sell, liters, byCarton, perCarton, errors, ok: !Object.values(errors).some(Boolean), blank };
  });
  const filled = rows.filter((r) => !r.blank);
  const goods = filled.reduce((s, r) => s + r.lot, 0);
  const fees = num(draft.transportCost) + num(draft.handlingCost);
  const canSave = online && filled.length > 0 && filled.every((r) => r.ok);

  const addSupplier = async () => {
    if (!newSupplier?.name.trim()) return;
    try {
      const res = await apiSend<{ data: Supplier & { phone?: string | null } }>("/api/suppliers", { name: newSupplier.name.trim(), phone: newSupplier.phone.trim() || undefined });
      setSuppliers((s) => [...s, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft((d) => ({ ...d, supplierId: res.data.id }));
      setNewSupplier(null);
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
    setBusy(true);
    setError(null);
    try {
      const bidon = units.find((u) => u.symbol === "bidon") ?? units[0];
      const carton = units.find((u) => u.symbol === "carton");
      const lines: Array<{ productId: string; quantity: number; unitPrice: number; totalPrice: number }> = [];
      for (const r of filled) {
        const cost = Math.round((r.lot / r.qty) * 100) / 100;
        // Prix de vente du carton et du lot : conditionnements de l'article
        const packagings: Array<{ unitId: string; factor: number; sellingPrice: number }> = [];
        if (carton && r.perCarton > 0 && num(r.l.cartonSellingPrice) > 0) packagings.push({ unitId: carton.id, factor: r.perCarton, sellingPrice: num(r.l.cartonSellingPrice) });
        if (num(r.l.lotPrice2) > 0 && num(r.l.lotSize) >= 2) packagings.push({ unitId: await lotUnit(num(r.l.lotSize)), factor: num(r.l.lotSize), sellingPrice: num(r.l.lotPrice2) });
        let id = r.product?.id;
        if (!id) {
          if (!bidon) throw new Error("Aucune unité disponible pour créer l'article");
          const base = r.l.name.trim();
          const litres = num(r.l.liters);
          // Filtres, colles… : pas de contenance
          const name = litersFromName(base) || !(litres > 0) ? base : `${base} ${fmtL(litres)}`;
          const created = await apiSend<{ data: { id: string } }>("/api/products", {
            name,
            baseUnitId: bidon.id,
            purchasePrice: cost,
            sellingPrice: r.sell,
            stockAlertQty: 7,
            ...(litres > 0 || litersFromName(base) ? { attributes: { contenance: fmtL(litres > 0 ? litres : litersFromName(base)!) } } : {}),
            ...(packagings.length ? { packagings } : {}),
          });
          id = created.data.id;
        } else {
          // Prix de vente revus avant l'enregistrement : on garde les autres conditionnements
          const keep = (r.product!.unitConversions ?? [])
            .filter((u) => !packagings.some((p) => p.unitId === u.fromUnitId))
            .map((u) => ({ unitId: u.fromUnitId, factor: Number(u.factor), sellingPrice: u.sellingPrice != null ? Number(u.sellingPrice) : null, barcode: u.barcode }));
          const priceChanged = Number(r.product!.sellingPrice) !== r.sell;
          if (canPrice && (priceChanged || packagings.length)) {
            await apiSend(`/api/products/${id}`, { sellingPrice: r.sell, ...(packagings.length ? { packagings: [...keep, ...packagings] } : {}) }, "PATCH");
          }
        }
        lines.push({ productId: id, quantity: r.qty, unitPrice: cost, totalPrice: Math.round(r.lot) });
      }
      const res = await apiSend<{ data: { id: string } }>("/api/goods-receipts", {
        centerId,
        supplierId: draft.supplierId || undefined,
        reference: draft.reference || undefined,
        receivedAt: draft.receivedAt,
        transportCost: num(draft.transportCost),
        handlingCost: num(draft.handlingCost),
        lines,
      });
      await apiSend(`/api/goods-receipts/${res.data.id}/validate`, {});
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
    const all = new Map<string, { name: string; kind: "stock" | "suggestion" }>();
    for (const p of products) all.set(norm(p.name), { name: p.name, kind: "stock" });
    for (const s of suggestions) if (!all.has(norm(s.name))) all.set(norm(s.name), { name: s.name, kind: "suggestion" });
    return [...all.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "fr") : a.kind === "stock" ? -1 : 1));
  }, [products, suggestions]);

  return (
    <Card className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Nouvel arrivage</h2>
        <span className="text-xs text-gray-500">
          {autosave.status === "saved" && autosave.savedAt && `Brouillon gardé sur cet appareil (${autosave.savedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })})`}
          {autosave.status === "error" && <span className="text-red-600">Sauvegarde locale impossible</span>}
        </span>
      </div>

      {autosave.restored && (
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
        {supplier && <p className="text-sm text-gray-600">📞 Contact du fournisseur : {supplier.phone ? <strong>{supplier.phone}</strong> : <span className="text-gray-400">non renseigné</span>}</p>}
        {newSupplier ? (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-xl bg-gray-50 p-3">
            <Field label="Nom du nouveau fournisseur">
              <Input value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} placeholder="ex. Distrilub Cotonou" />
            </Field>
            <Field label="Contact (téléphone)" hint="Servira dans les alertes de stock">
              <Input type="tel" value={newSupplier.phone} onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })} placeholder="+229 …" />
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={addSupplier} disabled={!newSupplier.name.trim() || !online}>
                Ajouter
              </Button>
              <Button variant="ghost" onClick={() => setNewSupplier(null)}>
                ✕
              </Button>
            </div>
          </div>
        ) : (
          <button className="text-sm text-blue-600 hover:underline" onClick={() => setNewSupplier({ name: "", phone: "" })}>
            + Nouveau fournisseur
          </button>
        )}
      </section>

      {/* 2. Articles */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">2. Articles reçus</h3>
        {rows.map((r, i) => {
          const word = unitWord(r.product?.baseUnit.symbol);
          const one = r.product?.baseUnit.symbol === "btl" ? "bouteille" : word === "seaux" ? "seau" : word.replace(/s$/, "");
          const costPer = r.qty > 0 && r.lot > 0 ? r.lot / r.qty : 0;
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
                  {r.l.name.trim() && (r.product ? <Badge tone="green">Déjà en stock</Badge> : <Badge tone="blue">Nouvel article</Badge>)}
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

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {r.product ? (
                  <Field label={`Contenance (par ${one})`}>
                    <Input value={r.liters ? fmtL(r.liters) : "—"} disabled readOnly />
                  </Field>
                ) : (
                  <Field label="Contenance (litres par bidon)" hint="Vide pour un filtre, une colle…">
                    <Input inputMode="decimal" value={r.l.liters} onChange={(e) => setLine(i, { liters: e.target.value })} placeholder="ex. 1" />
                  </Field>
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
              {r.qty > 0 && (
                <p className="text-sm text-gray-600">
                  Total reçu : <strong>{r.qty.toLocaleString("fr-FR")} {word}</strong>
                  {r.lot > 0 && (
                    <>
                      {" "}pour <Money value={r.lot} currency={currency} /> · revient à <strong><Money value={costPer} currency={currency} /></strong> le {one}
                    </>
                  )}
                </p>
              )}

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Prix de vente</p>
              {r.product && !canPrice && <p className="text-xs text-gray-500">Prix fixés par la direction : seuls la direction et le gérant peuvent les changer.</p>}
              <fieldset disabled={!!r.product && !canPrice} className="grid grid-cols-2 sm:grid-cols-4 gap-3 disabled:opacity-60">
                <Field label={`1 ${one}`} error={err(r.errors.sellingPrice)}>
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
              {costPer > 0 && r.sell > 0 && (
                <p className={`text-sm font-medium ${r.sell - costPer > 0 ? "text-green-700" : "text-red-700"}`}>
                  {r.sell - costPer >= 0 ? "Bénéfice" : "Perte"} : <Money value={Math.abs(r.sell - costPer)} currency={currency} /> par {one}
                </p>
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <p className="text-sm text-gray-700">
          Total payé : <strong><Money value={goods + fees} currency={currency} /></strong>
          {fees > 0 && <span className="text-gray-500"> (dont frais <Money value={fees} currency={currency} />)</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Fermer
          </Button>
          <Button variant="success" onClick={save} loading={busy} disabled={!online || busy}>
            Enregistrer l&apos;arrivage
          </Button>
        </div>
      </div>
      {tried && !canSave && filled.length > 0 && <Alert tone="amber">Complétez les champs en rouge pour enregistrer.</Alert>}
      {tried && filled.length === 0 && <Alert tone="amber">Ajoutez au moins un article.</Alert>}
    </Card>
  );
}
