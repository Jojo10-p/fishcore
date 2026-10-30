"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface Summary {
  lineCount: number;
  countedCount: number;
  gapValue: string;
  shortageValue: string;
  surplusValue: string;
}
interface InventoryRow {
  id: string;
  number: string;
  label: string | null;
  status: "IN_PROGRESS" | "VALIDATED" | "CANCELLED";
  createdAt: string;
  validatedAt: string | null;
  center: { name: string };
  summary: Summary;
}
interface Category {
  id: string;
  name: string;
  _count: { products: number };
}

const STATUS: Record<InventoryRow["status"], { label: string; tone: "amber" | "green" | "gray" }> = {
  IN_PROGRESS: { label: "En cours", tone: "amber" },
  VALIDATED: { label: "Validé", tone: "green" },
  CANCELLED: { label: "Annulé", tone: "gray" },
};

export default function InventairesPage() {
  const { centerId, currency, can } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<InventoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!centerId) return;
    try {
      const res = await apiGet<{ data: InventoryRow[] }>(`/api/inventories?centerId=${centerId}`);
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

  const inProgress = rows?.find((r) => r.status === "IN_PROGRESS");

  return (
    <>
      <PageHeader
        title="Inventaires"
        description="Comptez le stock réel : les écarts ne sont appliqués qu'à la validation, et chaque correction est tracée."
        actions={
          can("inventory:start") && !inProgress ? <Button onClick={() => setCreating(true)}>Nouvel inventaire</Button> : null
        }
      />
      {error && <Alert>{error}</Alert>}
      {inProgress && (
        <Alert tone="amber">
          L&apos;inventaire <strong>{inProgress.number}</strong> est en cours ({inProgress.summary.countedCount}/{inProgress.summary.lineCount} articles comptés).{" "}
          <Link className="underline font-medium" href={`/inventaires/${inProgress.id}`}>
            Continuer le comptage
          </Link>
        </Alert>
      )}

      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon="📋" title="Aucun inventaire pour ce centre">
            Lancez un inventaire complet ou par famille d&apos;articles (rayon, chambre froide…).
          </EmptyState>
        ) : (
          <Table head={["N°", "Libellé", "Date", "Avancement", "Écart valorisé", "Statut", ""]}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/inventaires/${r.id}`)}>
                <Td className="font-mono text-xs">{r.number}</Td>
                <Td>{r.label || <span className="text-gray-400">—</span>}</Td>
                <Td>{formatDate(r.validatedAt ?? r.createdAt)}</Td>
                <Td>
                  {r.summary.countedCount}/{r.summary.lineCount}
                </Td>
                <Td className={Number(r.summary.gapValue) < 0 ? "text-red-600" : Number(r.summary.gapValue) > 0 ? "text-green-700" : ""}>
                  {r.status === "CANCELLED" ? "—" : <Money value={r.summary.gapValue} currency={currency} />}
                </Td>
                <Td>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </Td>
                <Td className="text-right text-blue-600">Ouvrir →</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {creating && centerId && (
        <NewInventoryModal
          centerId={centerId}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/inventaires/${id}`)}
        />
      )}
    </>
  );
}

function NewInventoryModal({ centerId, onClose, onCreated }: { centerId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: Category[] }>("/api/categories")
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]));
  }, []);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { id: string } }>("/api/inventories", {
        centerId,
        label: label.trim() || undefined,
        categoryIds: selected.length > 0 ? selected : undefined,
      });
      onCreated(res.data.id);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Nouvel inventaire"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Préparation…" : "Commencer le comptage"}
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Libellé (facultatif)" hint="Ex. « Inventaire de fin d'année », « Chambre froide n°2 »">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} autoFocus />
      </Field>
      <Field label="Périmètre" hint="Sans sélection, tous les articles actifs sont à compter.">
        {!categories ? (
          <Spinner />
        ) : categories.length === 0 ? (
          <p className="text-sm text-gray-500">Tous les articles (aucune famille définie).</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const on = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                  className={`px-3 py-1.5 rounded-full border text-sm ${on ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
                >
                  {c.name} <span className={on ? "text-blue-100" : "text-gray-400"}>({c._count.products})</span>
                </button>
              );
            })}
          </div>
        )}
      </Field>
      <p className="text-sm text-gray-600">
        Les ventes continuent pendant le comptage : l&apos;écart de chaque article est calculé au moment où vous saisissez sa quantité.
      </p>
    </Modal>
  );
}
