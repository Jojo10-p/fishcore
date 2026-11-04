"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

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
  quotePrefix: string;
  quoteValidityDays: number;
  invoiceNotes: string | null;
  requiresPickup: boolean;
  invoiceFormat: "TICKET_80" | "A4";
  invoiceCounter: number;
}

// Paramètres de l'entreprise (cahier §4) : identité légale, métier, fiscalité
export default function SettingsPage() {
  const { can, refresh } = useSession();
  const editable = can("company:edit");
  const [data, setData] = useState<CompanySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextNumber, setNextNumber] = useState("");

  useEffect(() => {
    apiGet<{ data: CompanySettings }>("/api/company")
      .then((r) => setData(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (!data) return error ? <Alert>{error}</Alert> : <Spinner />;

  const set = (k: keyof CompanySettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
          quoteValidityDays: Number(data.quoteValidityDays) || 15,
          invoiceNotes: data.invoiceNotes ?? "",
          requiresPickup: data.requiresPickup,
          invoiceFormat: data.invoiceFormat,
          invoicePrefix: data.invoicePrefix,
          quotePrefix: data.quotePrefix,
          ...(nextNumber ? { nextInvoiceNumber: Number(nextNumber) } : {}),
        },
        "PATCH"
      );
      setData(res.data);
      setNextNumber("");
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
          <h2 className="font-semibold text-gray-900">Tickets et factures</h2>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700">Facture imprimée à la caisse</legend>
            {(
              [
                ["TICKET_80", "Ticket 80 mm", "Imprimante thermique (XP-80C…) : la facture sort sur le rouleau, comme un ticket."],
                ["A4", "Page A4", "Imprimante de bureau : facture complète avec en-tête, signatures et montant en lettres."],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="invoiceFormat"
                  className="mt-1"
                  checked={data.invoiceFormat === value}
                  disabled={!editable}
                  onChange={() => {
                    setSaved(false);
                    setData({ ...data, invoiceFormat: value });
                  }}
                />
                <span>
                  {label}
                  <span className="block text-xs text-gray-500">{hint}</span>
                </span>
              </label>
            ))}
            <p className="text-xs text-gray-500">L&apos;autre format reste disponible à tout moment depuis la facture.</p>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Préfixe des factures">
              <Input value={data.invoicePrefix} onChange={set("invoicePrefix")} disabled={!editable} maxLength={10} />
            </Field>
            <Field label="Prochain n° de facture" hint={`Actuellement ${data.invoicePrefix}-${String(data.invoiceCounter).padStart(6, "0")}`}>
              <Input
                inputMode="numeric"
                value={nextNumber}
                placeholder={String(data.invoiceCounter)}
                onChange={(e) => {
                  setSaved(false);
                  setNextNumber(e.target.value.replace(/\D/g, ""));
                }}
                disabled={!editable}
              />
            </Field>
            <Field label="Préfixe des devis">
              <Input value={data.quotePrefix} onChange={set("quotePrefix")} disabled={!editable} maxLength={10} />
            </Field>
            <Field label="Validité d'un devis (jours)">
              <Input inputMode="numeric" value={String(data.quoteValidityDays)} onChange={set("quoteValidityDays")} disabled={!editable} />
            </Field>
          </div>
          <p className="text-xs text-gray-500">
            Vous quittez un autre logiciel ? Indiquez le numéro qui suit votre dernière facture pour continuer la même suite. Le numéro ne peut
            jamais revenir en arrière.
          </p>
          <Field label="Mentions en bas des factures et devis" hint="Ex. : coordonnées bancaires, « Les marchandises vendues ne sont ni reprises ni échangées ».">
            <Textarea rows={3} value={data.invoiceNotes ?? ""} onChange={set("invoiceNotes")} disabled={!editable} />
          </Field>
        </Card>

        <Card className="p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Identité de l&apos;entreprise</h2>
          <p className="text-sm text-gray-500">Ces informations figurent en en-tête des factures et devis (IFU et RCCM compris).</p>
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
