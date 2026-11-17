"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input, Money, PageHeader, Spinner } from "@/components/ui";
import { useSession } from "@/components/app/session-provider";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface Decision {
  id: string;
  createdAt: string;
  status: "PENDING" | "DECIDED";
  oldCost: string;
  newCost: string;
  currentPrice: string;
  proposedPrice: string | null;
  oldQty: string;
  oldLeft: number;
  chosenPrice: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  canDecide: boolean;
  proposedBy: string | null;
  decidedBy: string | null;
  receipt: { receivedAt: string; supplier: { name: string } | null } | null;
  product: {
    name: string;
    sellingPrice: string;
    pendingPrice: string | null;
    pendingPriceLeft: string | null;
    baseUnit: { symbol: string };
  };
}

const n = (v: string | number | null | undefined) => Number(v ?? 0);
const qty = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

// Le prix d'achat a baissé : le patron choisit le prix de vente du nouveau stock.
// Son choix entre aussitôt dans le système (tout de suite, ou quand l'ancien stock est vendu).
export default function PriceDecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currency } = useSession();
  const [d, setD] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiGet<{ data: Decision }>(`/api/price-decisions/${id}`)
        .then((r) => setD(r.data))
        .catch((e) => setError(errorMessage(e))),
    [id]
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !d) return <Alert>{error}</Alert>;
  if (!d) return <Spinner />;

  const unit = d.product.baseUnit.symbol;
  const current = n(d.currentPrice);
  const choose = async (price: number) => {
    setBusy(price);
    setError(null);
    try {
      const r = await apiSend<{ data: { applied: boolean; pendingUntilSold: number | null } }>(`/api/price-decisions/${id}`, { price });
      setDone(
        r.data.applied
          ? `C'est fait : ${price.toLocaleString("fr-FR")} F est maintenant le prix à la caisse.`
          : `C'est fait : l'ancien stock reste à ${current.toLocaleString("fr-FR")} F. Dès que les ${qty(r.data.pendingUntilSold ?? 0)} ${unit} restants seront vendus, la caisse passera toute seule à ${price.toLocaleString("fr-FR")} F.`
      );
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const options: Array<{ price: number; label: string; hint: string }> = [
    { price: current, label: `Garder ${current.toLocaleString("fr-FR")} F`, hint: "Même prix pour l'ancien et le nouveau stock : plus de bénéfice sur le nouveau." },
  ];
  if (d.proposedPrice && n(d.proposedPrice) !== current) {
    options.push({
      price: n(d.proposedPrice),
      label: `Passer à ${n(d.proposedPrice).toLocaleString("fr-FR")} F`,
      hint: `Proposé à l'arrivage${d.proposedBy ? ` par ${d.proposedBy}` : ""}. L'ancien stock reste à ${current.toLocaleString("fr-FR")} F jusqu'à ce qu'il soit vendu.`,
    });
  }
  const otherPrice = Number(other.replace(/\s/g, "").replace(",", "."));
  const floor = Math.ceil(n(d.newCost) / 25) * 25;

  return (
    <>
      <PageHeader title="Quel prix de vente ?" description={d.product.name} />
      <div className="max-w-2xl space-y-4">
        {error && <Alert>{error}</Alert>}
        {done && <Alert tone="green">{done}</Alert>}

        <Card className="space-y-2 p-4 text-sm">
          <p>
            Arrivage du {d.receipt ? new Date(d.receipt.receivedAt).toLocaleDateString("fr-FR") : "—"}
            {d.receipt?.supplier ? ` chez ${d.receipt.supplier.name}` : ""}.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Ancien prix d&apos;achat</p>
              <p className="text-lg font-bold">
                <Money value={n(d.oldCost)} currency={currency} /> <span className="text-sm font-normal">/ {unit}</span>
              </p>
            </div>
            <div className="rounded-xl bg-green-50 p-3">
              <p className="text-xs uppercase tracking-wide text-green-700">Nouveau prix d&apos;achat</p>
              <p className="text-lg font-bold text-green-800">
                <Money value={n(d.newCost)} currency={currency} /> <span className="text-sm font-normal">/ {unit}</span>
              </p>
            </div>
          </div>
          <p>
            Prix de vente actuel : <strong><Money value={current} currency={currency} /></strong> le {unit}. Ancien stock encore à vendre :{" "}
            <strong>
              {qty(d.oldLeft)} {unit}
            </strong>
            .
          </p>
          <p className="text-xs text-gray-500">L&apos;ancien stock garde toujours son prix jusqu&apos;à ce qu&apos;il soit vendu.</p>
        </Card>

        {d.status === "DECIDED" ? (
          <Card className="p-4 text-sm">
            <p className="font-semibold">
              Prix choisi : <Money value={n(d.chosenPrice)} currency={currency} />
              {d.decidedBy ? ` par ${d.decidedBy}` : ""}
              {d.decidedAt ? ` le ${new Date(d.decidedAt).toLocaleDateString("fr-FR")}` : ""}.
            </p>
            {d.appliedAt ? (
              <p className="mt-1 text-green-700">✅ C&apos;est le prix à la caisse.</p>
            ) : (
              <p className="mt-1 text-amber-800">
                ⏳ Passera à la caisse quand l&apos;ancien stock sera vendu (encore {qty(Math.max(0, n(d.product.pendingPriceLeft)))} {unit}).
              </p>
            )}
            <Link href="/produits" className="mt-3 inline-block text-blue-600 hover:underline">
              Voir les articles →
            </Link>
          </Card>
        ) : !d.canDecide ? (
          <Alert tone="amber">Le patron doit choisir le prix de vente du nouveau stock.</Alert>
        ) : (
          <Card className="space-y-3 p-4">
            <p className="text-sm font-semibold text-gray-900">Pour le nouveau stock, on vend à…</p>
            {options.map((o) => (
              <button
                key={o.price}
                onClick={() => void choose(o.price)}
                disabled={busy !== null}
                className="w-full rounded-xl border-2 border-gray-200 p-3 text-left hover:border-blue-500 hover:bg-blue-50 disabled:opacity-60"
              >
                <span className="block text-base font-bold text-gray-900">{busy === o.price ? "Un instant…" : o.label}</span>
                <span className="block text-xs text-gray-600">{o.hint}</span>
              </button>
            ))}
            <div className="rounded-xl border-2 border-dashed border-gray-200 p-3">
              <Field label="Autre prix" hint={`Ne pas vendre en dessous de ${floor.toLocaleString("fr-FR")} F (prix d'achat).`} error={otherPrice > 0 && otherPrice < floor ? "Vente à perte !" : undefined}>
                <div className="flex gap-2">
                  <Input inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value)} placeholder={`ex. ${(current - 100).toLocaleString("fr-FR")}`} />
                  <Button onClick={() => void choose(otherPrice)} disabled={!(otherPrice > 0) || busy !== null} loading={busy === otherPrice}>
                    Valider
                  </Button>
                </div>
              </Field>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
