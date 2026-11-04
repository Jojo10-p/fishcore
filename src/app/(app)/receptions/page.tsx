"use client";

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
  trackBatches: boolean;
  requiresExpiry: boolean;
  baseUnit: { symbol: string; allowsDecimal: boolean };
}
interface Supplier {
  id: string;
  name: string;
}

interface DraftLine {
  productId: string;
  packageCount: string;
  grossWeight: string;
  quantity: string;
  lotNumber: string;
  expiresAt: string;
  unitPrice: string;
}
interface ReceiptDraft {
  supplierId: string;
  reference: string;
  receivedAt: string;
  transportCost: string;
  iceCost: string;
  handlingCost: string;
  otherCosts: string;
  lines: DraftLine[];
}

const emptyLine = (): DraftLine => ({ productId: "", packageCount: "", grossWeight: "", quantity: "", unitPrice: "", lotNumber: "", expiresAt: "" });
const emptyDraft = (): ReceiptDraft => ({
  supplierId: "",
  reference: "",
  receivedAt: new Date().toISOString().slice(0, 10),
  transportCost: "",
  iceCost: "",
  handlingCost: "",
  otherCosts: "",
  lines: [emptyLine()],
});
const num = (v: string) => Number((v || "0").replace(",", "."));

export default function ReceptionsPage() {
  const { centerId, currency, can } = useSession();
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
        title="Réceptions de marchandises"
        description="Le stock n'augmente qu'à la validation de la réception."
        actions={!creating && <Button onClick={() => setCreating(true)}>Nouvelle réception</Button>}
      />
      {error && <Alert>{error}</Alert>}
      {creating && centerId && (
        <div className="mb-6">
          <ReceiptForm
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
          <EmptyState icon="🚚" title="Aucune réception" />
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

// ── Saisie avec sauvegarde automatique (cahier §8.3) ─────
function ReceiptForm({ centerId, currency, onCancel, onSaved }: { centerId: string; currency: string; onCancel: () => void; onSaved: () => Promise<void> }) {
  const online = useOnline();
  const [draft, setDraft] = useState<ReceiptDraft>(emptyDraft);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [newSupplier, setNewSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const touched = useMemo(
    () => draft.supplierId !== "" || draft.reference !== "" || draft.lines.some((l) => l.productId || l.quantity || l.packageCount),
    [draft]
  );
  const { profile, session } = useSession();
  // Poids brut utile pour les marchandises pesées (poisson, vrac…)
  const showWeight = ["FISHMONGER", "WHOLESALE", "BUILDING_MATERIALS"].includes(session?.company?.businessType ?? "") || !!profile.units.find((u) => u.kind === "WEIGHT" && u.symbol === profile.defaultUnit);
  const autosave = useAutosaveDraft(`goods-receipt:v2:${centerId}`, draft, { enabled: touched });

  useEffect(() => {
    apiGet<{ data: ProductOption[] }>("/api/products").then((r) => setProducts(r.data)).catch(() => undefined);
    apiGet<{ data: Supplier[] }>("/api/suppliers").then((r) => setSuppliers(r.data)).catch(() => undefined);
  }, []);

  const setField = (k: keyof Omit<ReceiptDraft, "lines">) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  const setLine = (i: number, k: keyof DraftLine, v: string) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  const goods = draft.lines.reduce((s, l) => s + num(l.quantity) * num(l.unitPrice), 0);
  const fees = num(draft.transportCost) + num(draft.iceCost) + num(draft.handlingCost) + num(draft.otherCosts);
  const validLines = draft.lines.filter((l) => l.productId && num(l.quantity) > 0);
  const missingExpiry = draft.lines.some((l) => l.productId && !l.expiresAt && products.find((p) => p.id === l.productId)?.requiresExpiry);

  const addSupplier = async () => {
    if (!newSupplier.trim()) return;
    try {
      const res = await apiSend<{ data: Supplier }>("/api/suppliers", { name: newSupplier.trim() });
      setSuppliers((s) => [...s, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft((d) => ({ ...d, supplierId: res.data.id }));
      setNewSupplier("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const save = async (andValidate: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { id: string } }>("/api/goods-receipts", {
        centerId,
        supplierId: draft.supplierId || undefined,
        reference: draft.reference || undefined,
        receivedAt: draft.receivedAt,
        transportCost: num(draft.transportCost),
        iceCost: num(draft.iceCost),
        handlingCost: num(draft.handlingCost),
        otherCosts: num(draft.otherCosts),
        lines: validLines.map((l) => ({
          productId: l.productId,
          packageCount: l.packageCount ? Math.round(num(l.packageCount)) : undefined,
          grossWeight: l.grossWeight ? num(l.grossWeight) : undefined,
          quantity: num(l.quantity),
          lotNumber: l.lotNumber || undefined,
          expiresAt: l.expiresAt || undefined,
          unitPrice: num(l.unitPrice),
          totalPrice: Math.round(num(l.quantity) * num(l.unitPrice)),
        })),
      });
      if (andValidate) await apiSend(`/api/goods-receipts/${res.data.id}/validate`, {});
      await autosave.clear();
      await onSaved();
    } catch (e) {
      setError(errorMessage(e)); // le brouillon local est conservé
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-900">Nouvelle réception</h2>
        <span className="text-xs text-gray-500">
          {autosave.status === "saving" && "Enregistrement…"}
          {autosave.status === "saved" && autosave.savedAt && `Brouillon enregistré sur cet appareil à ${autosave.savedAt.toLocaleTimeString("fr-FR")}`}
          {autosave.status === "error" && <span className="text-red-600">Sauvegarde locale impossible</span>}
        </span>
      </div>

      {autosave.restored && (
        <Alert tone="blue">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Une réception non terminée a été retrouvée (dernière saisie le {new Date(autosave.restored.updatedAt).toLocaleString("fr-FR")}).
            </span>
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
              <Button
                variant="secondary"
                className="px-3 py-1.5"
                onClick={async () => {
                  await autosave.clear();
                }}
              >
                Ignorer
              </Button>
            </span>
          </div>
        </Alert>
      )}
      {!online && <Alert tone="amber">Hors connexion : la saisie est conservée sur cet appareil. L&apos;enregistrement se fera au retour du réseau.</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Fournisseur">
          <Select value={draft.supplierId} onChange={setField("supplierId")}>
            <option value="">— Sans fournisseur —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Référence (bon, facture…)">
          <Input value={draft.reference} onChange={setField("reference")} />
        </Field>
        <Field label="Date de réception">
          <Input type="date" value={draft.receivedAt} onChange={setField("receivedAt")} />
        </Field>
      </div>
      <div className="flex gap-2 items-end">
        <Field label="Ajouter un fournisseur">
          <Input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="Nom du fournisseur" />
        </Field>
        <Button variant="secondary" onClick={addSupplier} disabled={!newSupplier.trim() || !online}>
          Ajouter
        </Button>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Articles reçus</h3>
        {draft.lines.map((l, i) => {
          const product = products.find((p) => p.id === l.productId);
          return (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end rounded-lg border border-gray-200 p-3">
              <div className="col-span-2">
                <Field label="Article">
                  <Select
                    value={l.productId}
                    onChange={(e) => {
                      const p = products.find((x) => x.id === e.target.value);
                      setLine(i, "productId", e.target.value);
                      if (p && !l.unitPrice) setLine(i, "unitPrice", String(Number(p.purchasePrice)));
                    }}
                  >
                    <option value="">Choisir…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Colis (cartons, sacs…)">
                <Input inputMode="numeric" value={l.packageCount} onChange={(e) => setLine(i, "packageCount", e.target.value)} />
              </Field>
              <Field label={`Quantité (${product?.baseUnit.symbol ?? "unité"})`}>
                <Input inputMode={product?.baseUnit.allowsDecimal ? "decimal" : "numeric"} value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
              </Field>
              <Field label={`Coût / ${product?.baseUnit.symbol ?? "unité"}`}>
                <Input inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
              </Field>
              {showWeight && (
                <Field label="Poids brut">
                  <Input inputMode="decimal" value={l.grossWeight} onChange={(e) => setLine(i, "grossWeight", e.target.value)} />
                </Field>
              )}
              {product?.trackBatches && (
                <>
                  <Field label="N° de lot">
                    <Input value={l.lotNumber} onChange={(e) => setLine(i, "lotNumber", e.target.value)} />
                  </Field>
                  <Field label={`Péremption${product.requiresExpiry ? " *" : ""}`}>
                    <Input type="date" value={l.expiresAt} onChange={(e) => setLine(i, "expiresAt", e.target.value)} />
                  </Field>
                </>
              )}
              <div className="col-span-2 sm:col-span-6 flex items-center justify-between text-xs text-gray-500">
                <span>
                  {num(l.packageCount) > 0 && num(l.quantity) > 0 && (
                    <>Moyenne : <Qty value={num(l.quantity) / num(l.packageCount)} unit={`${product?.baseUnit.symbol ?? ""}/colis`} /> · </>
                  )}
                  Montant : <Money value={num(l.quantity) * num(l.unitPrice)} currency={currency} />
                </span>
                {draft.lines.length > 1 && (
                  <button className="text-red-600 hover:underline" onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}>
                    Retirer
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <Button variant="secondary" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))}>
          + Ajouter un article
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Transport">
          <Input inputMode="numeric" value={draft.transportCost} onChange={setField("transportCost")} />
        </Field>
        {session?.company?.businessType === "FISHMONGER" && (
          <Field label="Glace">
            <Input inputMode="numeric" value={draft.iceCost} onChange={setField("iceCost")} />
          </Field>
        )}
        <Field label="Manutention">
          <Input inputMode="numeric" value={draft.handlingCost} onChange={setField("handlingCost")} />
        </Field>
        <Field label="Autres frais">
          <Input inputMode="numeric" value={draft.otherCosts} onChange={setField("otherCosts")} />
        </Field>
      </div>

      {missingExpiry && <Alert tone="amber">Indiquez la date de péremption des articles marqués « * » avant de valider.</Alert>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <p className="text-sm text-gray-700">
          Marchandise <Money value={goods} currency={currency} /> + frais <Money value={fees} currency={currency} /> ={" "}
          <strong><Money value={goods + fees} currency={currency} /></strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Fermer (le brouillon reste sur l&apos;appareil)
          </Button>
          <Button variant="secondary" onClick={() => save(false)} loading={busy} disabled={!online || validLines.length === 0}>
            Enregistrer en brouillon
          </Button>
          <Button variant="success" onClick={() => save(true)} loading={busy} disabled={!online || validLines.length === 0 || missingExpiry}>
            Enregistrer et valider
          </Button>
        </div>
      </div>
    </Card>
  );
}
