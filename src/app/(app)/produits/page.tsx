"use client";

import Link from "next/link";
import { LOW_STOCK_THRESHOLD } from "@/lib/app-config";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { currencyLabel } from "@/lib/utils";

interface Unit {
  id: string;
  name: string;
  symbol: string;
  allowsDecimal: boolean;
  companyId?: string | null;
}
interface Category {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
  internalCode: string | null;
  barcode: string | null;
  brand: string | null;
  description: string | null;
  attributes: Record<string, string> | null;
  category: Category | null;
  purchasePrice: string;
  sellingPrice: string;
  stockAlertQty: string;
  taxRate: string;
  trackBatches: boolean;
  requiresExpiry: boolean;
  requiresPrescription: boolean;
  isActive: boolean;
  baseUnit: Unit;
  unitConversions: Array<{ fromUnitId: string; factor: string; sellingPrice: string | null; barcode: string | null; fromUnit: { name: string; symbol: string } }>;
}

/** « Nouvel article », « Nouveau produit », « Nouveau matériau ». */
function newLabel(word: string) {
  return `${/^[aeiouhéè]/i.test(word) ? "Nouvel" : "Nouveau"} ${word}`;
}

export default function ProductsPage() {
  const { can, currency, profile, centerId } = useSession();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [pricing, setPricing] = useState<Product | null>(null);
  const [history, setHistory] = useState<Product | null>(null);
  const [showUnits, setShowUnits] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ active: showInactive ? "false" : "true" });
      if (search) params.set("search", search);
      if (categoryId) params.set("categoryId", categoryId);
      if (centerId) params.set("centerId", centerId); // articles de la boutique ouverte
      const res = await apiGet<{ data: Product[] }>(`/api/products?${params}`);
      setProducts(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [search, categoryId, showInactive, centerId]);

  const loadRefs = useCallback(async () => {
    const [u, c] = await Promise.all([apiGet<{ data: Unit[] }>("/api/units"), apiGet<{ data: Category[] }>("/api/categories")]);
    setUnits(u.data);
    setCategories(c.data);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    const t = setTimeout(() => void loadRefs().catch(() => undefined), 0);
    return () => clearTimeout(t);
  }, [loadRefs]);

  const label = profile.productLabel;

  return (
    <>
      <PageHeader
        title={label.plural.charAt(0).toUpperCase() + label.plural.slice(1)}
        description="Catalogue commun à tous vos centres. Les changements de prix sont historisés."
        actions={
          can("product:create") && (
            <div className="flex flex-wrap gap-2">
              {can("unit:manage") && (
                <Button variant="secondary" onClick={() => setShowUnits(true)}>
                  Unités
                </Button>
              )}
              {can("product:import") && (
                <Link href="/produits/import">
                  <Button variant="secondary">Importer (Sage, Excel)</Button>
                </Link>
              )}
              <Button onClick={() => setEditing("new")}>✨ Ajouter un nouveau produit</Button>
            </div>
          )
        }
      />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input placeholder="Rechercher (nom, référence, code-barres, marque…)" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="sm:w-56" aria-label="Catégorie">
          <option value="">Toutes les catégories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Inclure les désactivés
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card>
        {!products ? (
          <Spinner />
        ) : products.length === 0 ? (
          <EmptyState title={`Aucun ${label.singular}`}>Créez votre premier {label.singular} pour commencer à vendre.</EmptyState>
        ) : (
          <Table head={["Réf.", "Désignation", "Catégorie", "Vente", "Prix d'achat", "Prix de vente", "Suivi", ""]}>
            {products.map((p) => (
              <tr key={p.id} className={p.isActive ? "" : "opacity-60"}>
                <Td className="font-mono text-xs text-gray-600">{p.internalCode ?? "—"}</Td>
                <Td className="whitespace-normal min-w-56">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-gray-500">
                    {[p.brand, p.barcode, ...Object.entries(p.attributes ?? {}).map(([k, v]) => `${k} : ${v}`)].filter(Boolean).join(" · ")}
                  </p>
                </Td>
                <Td>{p.category?.name ?? "—"}</Td>
                <Td className="whitespace-normal text-xs text-gray-600">
                  <span className="text-sm text-gray-800">{p.baseUnit.symbol}</span>
                  {p.unitConversions.map((c) => (
                    <span key={c.fromUnitId} className="block">
                      {c.fromUnit.symbol} = {Number(c.factor)} {p.baseUnit.symbol}
                      {c.sellingPrice && <> · <Money value={c.sellingPrice} currency={currency} /></>}
                    </span>
                  ))}
                </Td>
                <Td>
                  <Money value={p.purchasePrice} currency={currency} />
                </Td>
                <Td className="font-semibold">
                  <Money value={p.sellingPrice} currency={currency} />
                  {Number(p.taxRate) > 0 && <span className="block text-xs font-normal text-gray-500">TVA {Number(p.taxRate)} % incl.</span>}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {p.trackBatches && <Badge tone="blue">Lots</Badge>}
                    {p.requiresExpiry && <Badge tone="amber">Péremption</Badge>}
                    {p.requiresPrescription && <Badge tone="purple">Ordonnance</Badge>}
                    {!p.isActive && <Badge>Désactivé</Badge>}
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    {can("product:price") && (
                      <button className="whitespace-nowrap text-sm font-semibold text-blue-700 hover:underline" onClick={() => setPricing(p)}>
                        Changer le prix
                      </button>
                    )}
                    {can("audit:view") && (
                      <button className="text-sm text-gray-600 hover:underline" onClick={() => setHistory(p)}>
                        Historique
                      </button>
                    )}
                    {can("product:edit") && (
                      <button className="text-sm text-blue-600 hover:underline" onClick={() => setEditing(p)}>
                        Modifier
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {showUnits && (
        <UnitsModal
          units={units}
          onClose={() => setShowUnits(false)}
          onChanged={async () => {
            await loadRefs();
            await load();
          }}
        />
      )}
      {pricing && <PriceModal product={pricing} currency={currency} onClose={() => setPricing(null)} onSaved={load} />}
      {history && <PriceHistoryModal product={history} currency={currency} onClose={() => setHistory(null)} />}
      {editing && (
        <ProductModal
          product={editing === "new" ? null : editing}
          units={units}
          categories={categories}
          currency={currency}
          onRefsChanged={loadRefs}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </>
  );
}

// ── Fiche produit ────────────────────────────

interface PackagingRow {
  unitId: string;
  factor: string;
  sellingPrice: string;
  barcode: string;
}

function ProductModal({
  product,
  units,
  categories,
  currency,
  onRefsChanged,
  onClose,
  onSaved,
}: {
  product: Product | null;
  units: Unit[];
  categories: Category[];
  currency: string;
  onRefsChanged: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { profile, session, can, centerId } = useSession();
  // Prix déjà fixés : seuls la direction et le gérant les changent
  const priceLocked = !!product && !can("product:price");
  const vatEnabled = session?.company?.vatEnabled ?? false;
  const defaultUnit = units.find((u) => u.symbol === profile.defaultUnit) ?? units[0];

  const [form, setForm] = useState(() => ({
    name: product?.name ?? "",
    brand: product?.brand ?? "",
    categoryId: product?.category?.id ?? "",
    internalCode: product?.internalCode ?? "",
    barcode: product?.barcode ?? "",
    baseUnitId: product?.baseUnit.id ?? "",
    purchasePrice: product ? String(Number(product.purchasePrice)) : "",
    sellingPrice: product ? String(Number(product.sellingPrice)) : "",
    stockAlertQty: product ? String(Number(product.stockAlertQty)) : "",
    taxRate: product ? String(Number(product.taxRate)) : "",
  }));
  const [attributes, setAttributes] = useState<Array<{ key: string; value: string }>>(() => {
    const existing = Object.entries(product?.attributes ?? {}).map(([key, value]) => ({ key, value }));
    if (existing.length) return existing;
    return profile.suggestedAttributes.map((key) => ({ key, value: "" }));
  });
  const [packagings, setPackagings] = useState<PackagingRow[]>(
    () =>
      product?.unitConversions.map((c) => ({
        unitId: c.fromUnitId,
        factor: String(Number(c.factor)),
        sellingPrice: c.sellingPrice ? String(Number(c.sellingPrice)) : "",
        barcode: c.barcode ?? "",
      })) ?? []
  );
  const [flags, setFlags] = useState({
    trackBatches: product?.trackBatches ?? profile.productDefaults.trackBatches,
    requiresExpiry: product?.requiresExpiry ?? profile.productDefaults.requiresExpiry,
    requiresPrescription: product?.requiresPrescription ?? profile.productDefaults.requiresPrescription,
  });
  const [active, setActive] = useState(product?.isActive ?? true);
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Les unités peuvent arriver après l'ouverture de la fiche : unité par défaut du métier
  const baseUnitId = form.baseUnitId || defaultUnit?.id || "";
  const baseUnit = units.find((u) => u.id === baseUnitId);
  const priceChanged = product && (Number(form.sellingPrice) !== Number(product.sellingPrice) || Number(form.purchasePrice) !== Number(product.purchasePrice));

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    try {
      const res = await apiSend<{ data: Category }>("/api/categories", { name: newCategory.trim() });
      await onRefsChanged();
      setForm((f) => ({ ...f, categoryId: res.data.id }));
      setNewCategory("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const num = (v: string) => Number((v || "0").replace(",", "."));
    const payload = {
      name: form.name,
      brand: form.brand || undefined,
      categoryId: form.categoryId || null,
      internalCode: form.internalCode,
      barcode: form.barcode,
      purchasePrice: num(form.purchasePrice),
      sellingPrice: num(form.sellingPrice),
      stockAlertQty: LOW_STOCK_THRESHOLD,
      ...(form.taxRate !== "" ? { taxRate: num(form.taxRate) } : {}),
      attributes: Object.fromEntries(attributes.filter((a) => a.key.trim() && a.value.trim()).map((a) => [a.key.trim(), a.value.trim()])),
      packagings: packagings
        .filter((p) => p.unitId && num(p.factor) > 0)
        .map((p) => ({ unitId: p.unitId, factor: num(p.factor), sellingPrice: p.sellingPrice ? num(p.sellingPrice) : null, barcode: p.barcode || null })),
      ...flags,
    };
    try {
      if (product) await apiSend(`/api/products/${product.id}`, { ...payload, isActive: active }, "PATCH");
      else await apiSend("/api/products", { ...payload, baseUnitId, centerId: centerId ?? undefined, barcode: form.barcode || undefined, internalCode: form.internalCode || undefined });
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
      title={product ? `Modifier « ${product.name} »` : newLabel(profile.productLabel.singular)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy} disabled={!form.name || !baseUnitId}>
            Enregistrer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Désignation">
        <Input value={form.name} onChange={set("name")} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Catégorie">
          <Select value={form.categoryId} onChange={set("categoryId")}>
            <option value="">— Aucune —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Marque / fabricant">
          <Input value={form.brand} onChange={set("brand")} />
        </Field>
      </div>
      <div className="flex gap-2 items-end">
        <Field label="Nouvelle catégorie">
          <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="ex. Peinture" />
        </Field>
        <Button variant="secondary" onClick={addCategory} disabled={!newCategory.trim()}>
          Ajouter
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Référence interne">
          <Input value={form.internalCode} onChange={set("internalCode")} />
        </Field>
        <Field label="Code-barres" hint="Scannez-le directement dans ce champ.">
          <Input value={form.barcode} onChange={set("barcode")} inputMode="numeric" />
        </Field>
      </div>

      <Field label="Unité de vente et de stock" hint={product ? "Ne peut plus changer : le stock existant est compté dans cette unité." : "La plus petite unité vendue (kg, litre, pièce, boîte…)."}>
        <Select value={baseUnitId} onChange={set("baseUnitId")} disabled={!!product}>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol}){u.allowsDecimal ? " — décimales" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label={`Achat / ${baseUnit?.symbol ?? "u"}`}>
          <Input inputMode="decimal" value={form.purchasePrice} onChange={set("purchasePrice")} disabled={priceLocked} />
        </Field>
        <Field label={`Vente / ${baseUnit?.symbol ?? "u"}`}>
          <Input inputMode="decimal" value={form.sellingPrice} onChange={set("sellingPrice")} disabled={priceLocked} title={priceLocked ? "Seuls la direction et le gérant peuvent changer un prix" : undefined} />
        </Field>
        <Field label="TVA %" hint={vatEnabled ? "Incluse dans le prix" : "Entreprise non assujettie"}>
          <Input inputMode="decimal" value={form.taxRate} onChange={set("taxRate")} placeholder={vatEnabled ? "défaut" : "0"} />
        </Field>
        <Field label="Alerte stock" hint="Fixe pour tous les articles">
          <Input value={`à ${LOW_STOCK_THRESHOLD} ${baseUnit?.symbol ?? "u"}`} disabled readOnly />
        </Field>
      </div>

      {/* Conditionnements */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-700">Conditionnements vendus (carton, boîte, pack, sac…)</legend>
        {packagings.map((p, i) => (
          <div key={i} className="grid grid-cols-[1.2fr_0.8fr_1fr_1fr_auto] gap-2 items-center">
            <Select aria-label="Conditionnement" value={p.unitId} onChange={(e) => setPackagings((rows) => rows.map((r, j) => (j === i ? { ...r, unitId: e.target.value } : r)))}>
              <option value="">Unité…</option>
              {units
                .filter((u) => u.id !== baseUnitId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
            <Input aria-label={`Contenance en ${baseUnit?.symbol}`} placeholder={`= ? ${baseUnit?.symbol ?? ""}`} inputMode="decimal" value={p.factor} onChange={(e) => setPackagings((rows) => rows.map((r, j) => (j === i ? { ...r, factor: e.target.value } : r)))} />
            <Input aria-label="Prix du conditionnement" placeholder={`Prix (${currencyLabel(currency)})`} inputMode="decimal" disabled={priceLocked && !!product?.unitConversions.some((c) => c.fromUnitId === p.unitId && c.sellingPrice != null)} value={p.sellingPrice} onChange={(e) => setPackagings((rows) => rows.map((r, j) => (j === i ? { ...r, sellingPrice: e.target.value } : r)))} />
            <Input aria-label="Code-barres du conditionnement" placeholder="Code-barres" value={p.barcode} onChange={(e) => setPackagings((rows) => rows.map((r, j) => (j === i ? { ...r, barcode: e.target.value } : r)))} />
            <button className="text-gray-400 hover:text-red-600" onClick={() => setPackagings((rows) => rows.filter((_, j) => j !== i))} aria-label="Retirer">
              ✕
            </button>
          </div>
        ))}
        <button className="text-sm text-blue-600 hover:underline" onClick={() => setPackagings((rows) => [...rows, { unitId: "", factor: "", sellingPrice: "", barcode: "" }])}>
          + Ajouter un conditionnement
        </button>
        {packagings.length > 0 && <p className="text-xs text-gray-500">Prix vide = prix unitaire × contenance.</p>}
      </fieldset>

      {/* Caractéristiques libres */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-700">Caractéristiques</legend>
        {attributes.map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.5fr_auto] gap-2">
            <Input aria-label="Caractéristique" placeholder="ex. Dimension" value={a.key} onChange={(e) => setAttributes((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
            <Input aria-label="Valeur" placeholder="Valeur" value={a.value} onChange={(e) => setAttributes((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
            <button className="text-gray-400 hover:text-red-600" onClick={() => setAttributes((rows) => rows.filter((_, j) => j !== i))} aria-label="Retirer">
              ✕
            </button>
          </div>
        ))}
        <button className="text-sm text-blue-600 hover:underline" onClick={() => setAttributes((rows) => [...rows, { key: "", value: "" }])}>
          + Ajouter une caractéristique
        </button>
      </fieldset>

      {/* Suivi */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-700">Suivi</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={flags.trackBatches || flags.requiresExpiry} disabled={flags.requiresExpiry} onChange={(e) => setFlags((f) => ({ ...f, trackBatches: e.target.checked }))} />
          <span>
            Suivi par lot <span className="block text-xs text-gray-500">Chaque réception crée un lot ; la vente prend d&apos;abord le lot qui périme le plus tôt.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={flags.requiresExpiry} onChange={(e) => setFlags((f) => ({ ...f, requiresExpiry: e.target.checked, trackBatches: e.target.checked || f.trackBatches }))} />
          <span>
            Date de péremption obligatoire <span className="block text-xs text-gray-500">Médicaments, alimentaire… Les lots périmés ne peuvent pas être vendus.</span>
          </span>
        </label>
        {(session?.company?.businessType === "PHARMACY" || flags.requiresPrescription) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={flags.requiresPrescription} onChange={(e) => setFlags((f) => ({ ...f, requiresPrescription: e.target.checked }))} />
            <span>Délivré sur ordonnance (rappel à la caisse)</span>
          </label>
        )}
      </fieldset>

      {priceChanged && <Alert tone="amber">Changement de prix : il sera historisé. Les ventes hors connexion faites à l&apos;ancien prix passeront en conflit à examiner.</Alert>}
      {product && (
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Actif (vendable)
        </label>
      )}
    </Modal>
  );
}

/** Unités de l'entreprise : fractionnables ou non (¼ de carton, 1,5 kg…). */
function UnitsModal({ units, onClose, onChanged }: { units: Unit[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const own = units.filter((u) => u.companyId);
  const toggle = async (u: Unit) => {
    setBusy(u.id);
    setError(null);
    try {
      await apiSend(`/api/units/${u.id}`, { allowsDecimal: !u.allowsDecimal }, "PATCH");
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open onClose={onClose} title="Unités de vente">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-gray-600">
        Une unité <strong>fractionnable</strong> se vend aussi au quart ou au demi (0,25 carton, 1,5 kg). À la caisse, les boutons ¼ ½ ¾
        apparaissent pour ces unités.
      </p>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {own.map((u) => (
          <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{u.name}</span> <span className="text-gray-500">({u.symbol})</span>
            </span>
            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" checked={u.allowsDecimal} disabled={busy === u.id} onChange={() => toggle(u)} />
              Fractionnable
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ── Changer le prix (direction, gérant) ──────

const fmtNum = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");

function PriceModal({ product, currency, onClose, onSaved }: { product: Product; currency: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const rows = [
    { key: "base", label: `Prix ${product.baseUnit.name.toLowerCase()} (1 ${product.baseUnit.symbol})`, current: Number(product.sellingPrice) },
    ...product.unitConversions
      .filter((c) => c.sellingPrice != null)
      .map((c) => ({ key: c.fromUnitId, label: `Prix ${c.fromUnit.name.toLowerCase()} (${Number(c.factor)} ${product.baseUnit.symbol})`, current: Number(c.sellingPrice) })),
  ];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key, String(r.current)])));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => Number(String(v).replace(/\s/g, "").replace(",", "."));
  const bump = (key: string, delta: number) => setValues((v) => ({ ...v, [key]: String(Math.max(0, (num(v[key]) || 0) + delta)) }));
  const changed = rows.filter((r) => num(values[r.key]) !== r.current);
  const invalid = rows.some((r) => !(num(values[r.key]) > 0));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(
        `/api/products/${product.id}`,
        {
          sellingPrice: num(values.base),
          packagings: product.unitConversions.map((c) => ({
            unitId: c.fromUnitId,
            factor: Number(c.factor),
            sellingPrice: c.sellingPrice != null ? num(values[c.fromUnitId]) : null,
            barcode: c.barcode,
          })),
          ...(reason.trim() ? { priceReason: reason.trim() } : {}),
        },
        "PATCH"
      );
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
      title={`Changer le prix — ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} disabled={busy || invalid || changed.length === 0}>
            {busy ? "Enregistrement…" : "Enregistrer le nouveau prix"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Le nouveau prix s&apos;applique tout de suite à la caisse. L&apos;ancien prix, la date et votre nom sont gardés dans l&apos;historique.</p>
        {rows.map((r) => (
          <div key={r.key} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-gray-800">{r.label}</p>
              <p className="text-xs text-gray-500">
                Actuel : <Money value={r.current} currency={currency} />
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input inputMode="numeric" className="w-36" value={values[r.key]} onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))} aria-label={r.label} />
              {[-100, 100, 200, 500].map((d) => (
                <button key={d} type="button" onClick={() => bump(r.key, d)} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm font-semibold hover:bg-gray-50">
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
              {num(values[r.key]) !== r.current && num(values[r.key]) > 0 && (
                <span className={`text-sm font-semibold ${num(values[r.key]) > r.current ? "text-green-700" : "text-red-700"}`}>
                  {num(values[r.key]) > r.current ? "+" : "−"}
                  {fmtNum(Math.abs(num(values[r.key]) - r.current))}
                </span>
              )}
            </div>
          </div>
        ))}
        <Field label="Motif (facultatif)" hint="ex. hausse du fournisseur">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </Field>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}

interface PriceEvent {
  id: string;
  at: string;
  by: string | null;
  reason: string | null;
  changes: Array<{ label: string; before: string | null; after: string | null }>;
}

function PriceHistoryModal({ product, currency, onClose }: { product: Product; currency: string; onClose: () => void }) {
  const [events, setEvents] = useState<PriceEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ data: { history: PriceEvent[] } }>(`/api/products/${product.id}/price-history`)
      .then((r) => setEvents(r.data.history))
      .catch((e) => setError(errorMessage(e)));
  }, [product.id]);
  const date = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString("fr-FR")} à ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return (
    <Modal open size="lg" title={`Historique des prix — ${product.name}`} onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      {!events && !error ? (
        <Spinner />
      ) : events && events.length === 0 ? (
        <EmptyState title="Aucun changement de prix">Le prix n&apos;a pas été modifié depuis la création de l&apos;article.</EmptyState>
      ) : (
        events && (
          <Table head={["Date", "Par", "Changement", "Motif"]}>
            {events.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{date(e.at)}</Td>
                <Td>{e.by ?? "—"}</Td>
                <Td className="whitespace-normal">
                  {e.changes.length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    e.changes.map((c) => (
                      <span key={c.label} className="block">
                        <span className="text-gray-500">{c.label} : </span>
                        {c.before != null ? <Money value={c.before} currency={currency} /> : "—"} → <strong>{c.after != null ? <Money value={c.after} currency={currency} /> : "—"}</strong>
                      </span>
                    ))
                  )}
                </Td>
                <Td className="whitespace-normal text-gray-600">{e.reason ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        )
      )}
    </Modal>
  );
}
