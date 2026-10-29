"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Qty, Select, Spinner, Table, Td, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import type { Permission } from "@/lib/rbac";

interface StockRow {
  id: string;
  productId: string;
  quantity: string;
  reservedQty: string;
  updatedAt: string;
  product: { id: string; name: string; species: string | null; stockAlertQty: string; isActive: boolean; baseUnit: { symbol: string } };
}

// Mouvements manuels autorisés selon le rôle (le serveur revérifie)
const MOVEMENTS: Array<{ type: string; label: string; help: string; permission: Permission; signed?: boolean }> = [
  { type: "LOSS", label: "Perte", help: "Poisson perdu, volé ou manquant.", permission: "stock:loss" },
  { type: "DETERIORATION", label: "Détérioration", help: "Poisson avarié ou impropre à la vente.", permission: "stock:loss" },
  { type: "INVENTORY_ADJUST", label: "Ajustement d'inventaire", help: "Écart constaté au comptage (+ ou −).", permission: "stock:adjust", signed: true },
  { type: "CORRECTION", label: "Correction", help: "Correction d'une erreur de saisie (+ ou −).", permission: "stock:adjust", signed: true },
];

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
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);

  const load = useCallback(async () => {
    if (!centerId) return;
    try {
      const res = await apiGet<{ data: StockRow[] }>(`/api/stock?centerId=${centerId}${alertOnly ? "&lowStock=true" : ""}`);
      setRows(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [centerId, alertOnly]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const canMove = MOVEMENTS.some((m) => can(m.permission));
  const filtered = rows?.filter((r) => r.product.name.toLowerCase().includes(search.toLowerCase())) ?? null;
  const centerName = session?.centers.find((c) => c.id === centerId)?.name;

  return (
    <>
      <PageHeader title={alertOnly ? "Stocks en alerte" : "Stock"} description={centerName ? `Centre : ${centerName}` : undefined} />
      <Input placeholder="Rechercher un produit" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 sm:max-w-sm" />
      {error && <Alert>{error}</Alert>}
      <Card>
        {!filtered ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState icon="📦" title={alertOnly ? "Aucun produit en alerte" : "Aucun stock"}>
            Le stock augmente à la validation d&apos;une réception.
          </EmptyState>
        ) : (
          <Table head={["Produit", "En stock", "Réservé caisses", "Disponible", "Seuil", ""]}>
            {filtered.map((r) => {
              const unit = r.product.baseUnit.symbol;
              const qty = Number(r.quantity);
              const low = qty <= Number(r.product.stockAlertQty);
              return (
                <tr key={r.id}>
                  <Td>
                    <p className="font-medium">{r.product.name}</p>
                    {r.product.species && <p className="text-xs text-gray-500">{r.product.species}</p>}
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
                  <Td>{low ? <Badge tone="amber">alerte</Badge> : <span className="text-gray-400"><Qty value={r.product.stockAlertQty} unit={unit} /></span>}</Td>
                  <Td>
                    {canMove && (
                      <button className="text-sm text-blue-600 hover:underline" onClick={() => setAdjusting(r)}>
                        Mouvement
                      </button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      {adjusting && centerId && (
        <MovementModal row={adjusting} centerId={centerId} allowed={MOVEMENTS.filter((m) => can(m.permission))} onClose={() => setAdjusting(null)} onDone={load} />
      )}
    </>
  );
}

function MovementModal({
  row,
  centerId,
  allowed,
  onClose,
  onDone,
}: {
  row: StockRow;
  centerId: string;
  allowed: typeof MOVEMENTS;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [type, setType] = useState(allowed[0]?.type ?? "");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const movement = allowed.find((m) => m.type === type);
  const unit = row.product.baseUnit.symbol;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/stock", { centerId, productId: row.productId, type, quantity: Number(quantity.replace(",", ".")), reason });
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
          <Button onClick={submit} loading={busy} disabled={!quantity || Number(quantity) === 0 || reason.trim().length < 3}>
            Enregistrer
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        Stock actuel : <strong><Qty value={row.quantity} unit={unit} /></strong>. Chaque mouvement est justifié et historisé ; le stock ne peut pas devenir négatif.
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
      <Field label={`Quantité (${unit})`} hint={movement?.signed ? "Positive pour ajouter, négative pour retirer." : "Quantité retirée du stock."}>
        <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </Field>
      <Field label="Motif (obligatoire)">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}
