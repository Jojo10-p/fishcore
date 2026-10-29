"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Button, Card, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { BUSINESS_PROFILES, BUSINESS_TYPE_ORDER } from "@/lib/business-profiles";
import { cn } from "@/lib/utils";

interface CompanySettings {
  tradeName: string;
  legalName: string | null;
  phone: string;
  address: string | null;
  city: string | null;
  commune: string | null;
  poBox: string | null;
  taxId: string | null;
  tradeRegNumber: string | null;
  businessType: string;
  vatEnabled: boolean;
  defaultTaxRate: string;
  currency: string;
  invoicePrefix: string;
}

// Paramètres de l'entreprise (cahier §4) : identité légale, métier, fiscalité
export default function SettingsPage() {
  const { can, refresh } = useSession();
  const editable = can("company:edit");
  const [data, setData] = useState<CompanySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ data: CompanySettings }>("/api/company")
      .then((r) => setData(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (!data) return error ? <Alert>{error}</Alert> : <Spinner />;

  const set = (k: keyof CompanySettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setData({ ...data, [k]: e.target.value });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: CompanySettings }>(
        "/api/company",
        {
          tradeName: data.tradeName,
          legalName: data.legalName ?? "",
          phone: data.phone,
          address: data.address ?? "",
          city: data.city ?? "",
          commune: data.commune ?? "",
          poBox: data.poBox ?? "",
          taxId: data.taxId ?? "",
          tradeRegNumber: data.tradeRegNumber ?? "",
          businessType: data.businessType,
          vatEnabled: data.vatEnabled,
          defaultTaxRate: Number(String(data.defaultTaxRate).replace(",", ".")),
        },
        "PATCH"
      );
      setData(res.data);
      setSaved(true);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Paramètres de l'entreprise" description={editable ? undefined : "Consultation seule : seul le propriétaire peut modifier ces informations."} />
      <div className="space-y-6 max-w-3xl">
        {error && <Alert>{error}</Alert>}
        {saved && <Alert tone="green">Paramètres enregistrés.</Alert>}

        <Card className="p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Métier</h2>
          <p className="text-sm text-gray-500">
            Le métier pré-remplit les unités, catégories et options des nouveaux articles. En changer ajoute les unités et catégories du
            nouveau métier sans rien supprimer ; les articles existants ne changent pas.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {BUSINESS_TYPE_ORDER.map((type) => {
              const p = BUSINESS_PROFILES[type];
              const selected = data.businessType === type;
              return (
                <button
                  key={type}
                  type="button"
                  disabled={!editable}
                  onClick={() => {
                    setSaved(false);
                    setData({ ...data, businessType: type });
                  }}
                  className={cn(
                    "flex items-start gap-2 rounded-xl border p-3 text-left text-sm",
                    selected ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300",
                    !editable && "cursor-not-allowed"
                  )}
                >
                  <span className="text-xl leading-none" aria-hidden>
                    {p.icon}
                  </span>
                  <span>
                    <span className="block font-medium text-gray-900">{p.label}</span>
                    <span className="block text-xs text-gray-500">{p.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Fiscalité</h2>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={data.vatEnabled}
              disabled={!editable}
              onChange={(e) => {
                setSaved(false);
                setData({ ...data, vatEnabled: e.target.checked });
              }}
            />
            <span>
              Entreprise assujettie à la TVA
              <span className="block text-xs text-gray-500">Les prix de vente sont saisis TTC ; la TVA est calculée et affichée sur les reçus.</span>
            </span>
          </label>
          {data.vatEnabled && (
            <Field label="Taux de TVA par défaut (%)" hint="Appliqué aux nouveaux articles. Peut être modifié article par article (ex. produits exonérés).">
              <Input inputMode="decimal" value={String(Number(data.defaultTaxRate))} onChange={set("defaultTaxRate")} disabled={!editable} className="w-32" />
            </Field>
          )}
          <p className="text-xs text-gray-500">
            Les règles fiscales (facturation normalisée, exonérations) doivent être validées avec un professionnel avant la mise en production.
          </p>
        </Card>

        <Card className="p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Identité de l&apos;entreprise</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nom commercial">
              <Input value={data.tradeName} onChange={set("tradeName")} disabled={!editable} />
            </Field>
            <Field label="Dénomination sociale">
              <Input value={data.legalName ?? ""} onChange={set("legalName")} disabled={!editable} />
            </Field>
            <Field label="Téléphone">
              <Input value={data.phone} onChange={set("phone")} disabled={!editable} />
            </Field>
            <Field label="Adresse">
              <Input value={data.address ?? ""} onChange={set("address")} disabled={!editable} />
            </Field>
            <Field label="Ville">
              <Input value={data.city ?? ""} onChange={set("city")} disabled={!editable} />
            </Field>
            <Field label="Commune">
              <Input value={data.commune ?? ""} onChange={set("commune")} disabled={!editable} />
            </Field>
            <Field label="Boîte postale">
              <Input value={data.poBox ?? ""} onChange={set("poBox")} disabled={!editable} />
            </Field>
            <Field label="IFU">
              <Input value={data.taxId ?? ""} onChange={set("taxId")} disabled={!editable} />
            </Field>
            <Field label="RCCM">
              <Input value={data.tradeRegNumber ?? ""} onChange={set("tradeRegNumber")} disabled={!editable} />
            </Field>
          </div>
        </Card>

        {editable && (
          <div className="flex justify-end">
            <Button onClick={save} loading={busy}>
              Enregistrer les paramètres
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
