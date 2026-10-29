"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface Product {
  id: string;
  name: string;
  internalCode: string | null;
  barcode: string | null;
  species: string | null;
  type: string;
  sellingPrice: string;
  purchasePrice: string;
  stockAlertQty: string;
  isActive: boolean;
  baseUnit: { id: string; name: string; symbol: string };
}
interface Unit {
  id: string;
  name: string;
  symbol: string;
}

const TYPES: Record<string, string> = { FRESH: "Frais", FROZEN: "Congelé", SMOKED: "Fumé", DRIED: "Séché", OTHER: "Autre" };

type FormState = {
  name: string;
  species: string;
  type: string;
  internalCode: string;
  barcode: string;
  baseUnitId: string;
  purchasePrice: string;
  sellingPrice: string;
  stockAlertQty: string;
};
const EMPTY: FormState = { name: "", species: "", type: "FRESH", internalCode: "", barcode: "", baseUnitId: "", purchasePrice: "", sellingPrice: "", stockAlertQty: "" };

export default function ProductsPage() {
  const { can, currency } = useSession();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ active: showInactive ? "false" : "true" });
      if (search) params.set("search", search);
      const res = await apiGet<{ data: Product[] }>(`/api/products?${params}`);
      setProducts(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [search, showInactive]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    apiGet<{ data: Unit[] }>("/api/units")
      .then((r) => setUnits(r.data))
      .catch(() => setUnits([]));
  }, []);

  return (
    <>
      <PageHeader
        title="Produits"
        description="Catalogue commun à tous vos centres. Toute modification de prix est historisée."
        actions={can("product:create") && <Button onClick={() => setEditing("new")}>Nouveau produit</Button>}
      />
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input placeholder="Rechercher (nom, code, espèce…)" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Inclure les produits désactivés
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card>
        {!products ? (
          <Spinner />
        ) : products.length === 0 ? (
          <EmptyState title="Aucun produit">Créez votre premier produit pour commencer à vendre.</EmptyState>
        ) : (
          <Table head={["Produit", "Type", "Unité", "Prix d'achat", "Prix de vente", "Seuil d'alerte", ""]}>
            {products.map((p) => (
              <tr key={p.id} className={p.isActive ? "" : "opacity-60"}>
                <Td>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-gray-500">{[p.species, p.internalCode].filter(Boolean).join(" · ")}</p>
                </Td>
                <Td>{TYPES[p.type] ?? p.type}</Td>
                <Td>{p.baseUnit.symbol}</Td>
                <Td><Money value={p.purchasePrice} currency={currency} /></Td>
                <Td className="font-semibold"><Money value={p.sellingPrice} currency={currency} /></Td>
                <Td>{Number(p.stockAlertQty)} {p.baseUnit.symbol}</Td>
                <Td>
                  {!p.isActive && <Badge>désactivé</Badge>}
                  {can("product:edit") && (
                    <button className="ml-2 text-sm text-blue-600 hover:underline" onClick={() => setEditing(p)}>
                      Modifier
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && <ProductModal product={editing === "new" ? null : editing} units={units} currency={currency} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  );
}

function ProductModal({
  product,
  units,
  currency,
  onClose,
  onSaved,
}: {
  product: Product | null;
  units: Unit[];
  currency: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() =>
    product
      ? {
          name: product.name,
          species: product.species ?? "",
          type: product.type,
          internalCode: product.internalCode ?? "",
          barcode: product.barcode ?? "",
          baseUnitId: product.baseUnit.id,
          purchasePrice: String(Number(product.purchasePrice)),
          sellingPrice: String(Number(product.sellingPrice)),
          stockAlertQty: String(Number(product.stockAlertQty)),
        }
      : { ...EMPTY, baseUnitId: units[0]?.id ?? "" }
  );
  const [active, setActive] = useState(product?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const priceChanged = product && (Number(form.sellingPrice) !== Number(product.sellingPrice) || Number(form.purchasePrice) !== Number(product.purchasePrice));

  const save = async () => {
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name,
      species: form.species || undefined,
      type: form.type,
      internalCode: form.internalCode || undefined,
      barcode: form.barcode || undefined,
      purchasePrice: Number(form.purchasePrice || 0),
      sellingPrice: Number(form.sellingPrice || 0),
      stockAlertQty: Number(form.stockAlertQty || 0),
    };
    try {
      if (product) await apiSend(`/api/products/${product.id}`, { ...payload, isActive: active }, "PATCH");
      else await apiSend("/api/products", { ...payload, baseUnitId: form.baseUnitId });
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
      title={product ? `Modifier « ${product.name} »` : "Nouveau produit"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy} disabled={!form.name || (!product && !form.baseUnitId)}>
            Enregistrer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Nom">
        <Input value={form.name} onChange={set("name")} placeholder="Tilapia frais" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Espèce">
          <Input value={form.species} onChange={set("species")} placeholder="Tilapia" />
        </Field>
        <Field label="Type">
          <Select value={form.type} onChange={set("type")}>
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Code interne">
          <Input value={form.internalCode} onChange={set("internalCode")} />
        </Field>
        <Field label="Code-barres">
          <Input value={form.barcode} onChange={set("barcode")} />
        </Field>
      </div>
      <Field label="Unité de vente et de stock" hint={product ? "L'unité ne peut plus être changée : le stock existant en dépend." : undefined}>
        <Select value={form.baseUnitId} onChange={set("baseUnitId")} disabled={!!product}>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={`Prix d'achat (${currency})`}>
          <Input inputMode="numeric" value={form.purchasePrice} onChange={set("purchasePrice")} />
        </Field>
        <Field label={`Prix de vente (${currency})`}>
          <Input inputMode="numeric" value={form.sellingPrice} onChange={set("sellingPrice")} />
        </Field>
        <Field label="Seuil d'alerte">
          <Input inputMode="decimal" value={form.stockAlertQty} onChange={set("stockAlertQty")} />
        </Field>
      </div>
      {priceChanged && (
        <Alert tone="amber">
          Changement de prix : il sera historisé. Les ventes hors connexion faites à l&apos;ancien prix passeront en conflit à examiner.
        </Alert>
      )}
      {product && (
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Produit actif (vendable)
        </label>
      )}
    </Modal>
  );
}
