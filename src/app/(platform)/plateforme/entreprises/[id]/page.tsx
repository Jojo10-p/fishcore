"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { day, fcfa, StatusBadge, type SubStatus } from "@/components/platform/shell";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface Plan {
  code: string;
  name: string;
  monthlyPrice: number;
  maxCenters: number | null;
  maxUsers: number | null;
  isActive: boolean;
}
interface Company {
  id: string;
  tradeName: string;
  legalName: string | null;
  ownerName: string;
  email: string;
  phone: string;
  address: string | null;
  city: string | null;
  taxId: string | null;
  businessType: string;
  createdAt: string;
  status: SubStatus;
  suspendedAt: string | null;
  suspendedReason: string | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
  accessEndsAt: string | null;
  readOnlyFrom: string | null;
  daysLeft: number | null;
  planCode: string;
  customMaxCenters: number | null;
  customMaxUsers: number | null;
  platformNotes: string | null;
  plan: Plan;
  limits: { maxCenters: number | null; maxUsers: number | null };
  products: number;
  centers: Array<{ id: string; name: string; code: string; status: string }>;
  users: Array<{ id: string; firstName: string; lastName: string; email: string; phone: string | null; role: string; isActive: boolean; lastLoginAt: string | null }>;
  subscriptionPayments: Array<{ id: string; createdAt: string; planCode: string; amount: number; months: number; method: string; reference: string | null; periodStart: string; periodEnd: string; notes: string | null }>;
  activity: { sales30d: number; revenue30d: number; lastSaleAt: string | null; lastLoginAt: string | null };
}

const METHODS: Record<string, string> = { MOBILE_MONEY: "Mobile Money", VIREMENT: "Virement", ESPECES: "Espèces", AUTRE: "Autre" };
const ROLES: Record<string, string> = { COMPANY_OWNER: "Propriétaire", CENTER_MANAGER: "Gérant", CASHIER: "Caissier", ACCOUNTANT: "Comptable", STOCK_MANAGER: "Magasinier", SALES_EMPLOYEE: "Vendeur" };

export default function PlatformCompany() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<Company | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"payment" | "suspend" | "settings" | null>(null);
  const [link, setLink] = useState<{ url: string; owner: { firstName: string; phone: string | null } } | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([apiGet<{ data: Company }>(`/api/platform/companies/${id}`), apiGet<{ data: Plan[] }>("/api/platform/plans")]);
      setC(r.data);
      setNotes(r.data.platformNotes ?? "");
      setPlans(p.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const patch = async (body: Record<string, unknown>, msg: string) => {
    setError(null);
    try {
      const r = await apiSend<{ data: Company }>(`/api/platform/companies/${id}`, body, "PATCH");
      setC(r.data);
      setNotice(msg);
      setModal(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const resetLink = async () => {
    try {
      const r = await apiSend<{ data: { url: string; owner: { firstName: string; phone: string | null } } }>(`/api/platform/companies/${id}/reset-link`, {});
      setLink(r.data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (error && !c) return <Alert>{error}</Alert>;
  if (!c) return <Spinner />;

  return (
    <>
      <PageHeader
        title={c.tradeName}
        description={`${c.ownerName} · ${c.phone} · ${c.email}${c.city ? ` · ${c.city}` : ""} · inscrite le ${day(c.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/plateforme/clients">
              <Button variant="secondary">← Clients</Button>
            </Link>
            <Button onClick={() => setModal("payment")}>Enregistrer un paiement</Button>
          </div>
        }
      />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      {c.status === "SUSPENDED" && (
        <Alert tone="amber">
          Suspendu le {day(c.suspendedAt)} : {c.suspendedReason}
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Box label="Statut">
          <StatusBadge status={c.status} />
          <p className="mt-1 text-xs text-gray-500">
            Offre {c.plan.name}
            {c.plan.monthlyPrice ? ` · ${fcfa(c.plan.monthlyPrice)}/mois` : ""}
          </p>
        </Box>
        <Box label="Échéance">
          <p className="font-semibold">{day(c.accessEndsAt)}</p>
          <p className="text-xs text-gray-500">
            {c.daysLeft === null ? "sans échéance" : c.daysLeft >= 0 ? `dans ${c.daysLeft} jour(s)` : `dépassée de ${-c.daysLeft} jour(s)`}
            {c.status === "GRACE" && c.readOnlyFrom ? ` · consultation seule le ${day(c.readOnlyFrom)}` : ""}
          </p>
        </Box>
        <Box label="Activité (30 jours)">
          <p className="font-semibold">{c.activity.sales30d} vente(s)</p>
          <p className="text-xs text-gray-500">
            {fcfa(c.activity.revenue30d)} · dernière vente {day(c.activity.lastSaleAt)}
          </p>
        </Box>
        <Box label="Utilisation">
          <p className="font-semibold">
            {c.centers.filter((x) => x.status === "ACTIVE").length}/{c.limits.maxCenters ?? "∞"} centre(s) · {c.users.filter((u) => u.isActive).length}/{c.limits.maxUsers ?? "∞"} util.
          </p>
          <p className="text-xs text-gray-500">{c.products} article(s)</p>
        </Box>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="font-semibold text-gray-900">Paiements d&apos;abonnement</h2>
          {c.subscriptionPayments.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">Aucun paiement enregistré.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-gray-500">
                  <th className="py-2">Date</th>
                  <th className="py-2">Offre</th>
                  <th className="py-2">Période</th>
                  <th className="py-2">Moyen</th>
                  <th className="py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {c.subscriptionPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2">{day(p.createdAt)}</td>
                    <td className="py-2">
                      {plans.find((x) => x.code === p.planCode)?.name ?? p.planCode} · {p.months} mois
                    </td>
                    <td className="py-2 text-gray-600">
                      {day(p.periodStart)} → {day(p.periodEnd)}
                    </td>
                    <td className="py-2 text-gray-600">
                      {METHODS[p.method] ?? p.method}
                      {p.reference ? ` (${p.reference})` : ""}
                    </td>
                    <td className="py-2 text-right font-medium">{fcfa(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 className="mt-6 font-semibold text-gray-900">Utilisateurs</h2>
          <ul className="mt-2 divide-y divide-gray-100 text-sm">
            {c.users.map((u) => (
              <li key={u.id} className="flex justify-between gap-3 py-1.5">
                <span>
                  {u.firstName} {u.lastName} <span className="text-gray-500">· {ROLES[u.role] ?? u.role} · {u.email}</span>
                  {!u.isActive && <span className="ml-1 text-xs text-red-600">désactivé</span>}
                </span>
                <span className="text-xs text-gray-500">connexion {day(u.lastLoginAt)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">Centres : {c.centers.map((x) => `${x.name} (${x.code})`).join(", ") || "aucun"}</p>
        </Card>

        <div className="space-y-4">
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold text-gray-900">Actions</h2>
            <Button variant="secondary" className="w-full" onClick={() => setModal("settings")}>
              Offre, essai et limites
            </Button>
            <Button variant="secondary" className="w-full" onClick={resetLink}>
              🔑 Lien de mot de passe du patron
            </Button>
            {c.status === "SUSPENDED" ? (
              <Button variant="success" className="w-full" onClick={() => void patch({ reactivate: true }, "Compte réactivé.")}>
                Réactiver le compte
              </Button>
            ) : (
              <Button variant="danger" className="w-full" onClick={() => setModal("suspend")}>
                Suspendre le compte
              </Button>
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold text-gray-900">Notes internes</h2>
            <p className="text-xs text-gray-500">Jamais visibles par le client.</p>
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Relances, accords particuliers…" />
            <Button variant="secondary" onClick={() => void patch({ platformNotes: notes || null }, "Notes enregistrées.")}>
              Enregistrer les notes
            </Button>
          </Card>
          <Card className="p-4 text-sm text-gray-600">
            <p>IFU : {c.taxId ?? "—"}</p>
            {c.address && <p>{c.address}</p>}
            {c.legalName && <p>{c.legalName}</p>}
          </Card>
        </div>
      </div>

      {modal === "payment" && <PaymentModal company={c} plans={plans} onClose={() => setModal(null)} onDone={async (msg) => { await load(); setModal(null); setNotice(msg); }} />}
      {modal === "suspend" && <SuspendModal onClose={() => setModal(null)} onSubmit={(reason) => patch({ suspend: { reason } }, "Compte suspendu : tous ses utilisateurs ont été déconnectés.")} />}
      {modal === "settings" && <SettingsModal company={c} plans={plans} onClose={() => setModal(null)} onSubmit={(body) => patch(body, "Abonnement mis à jour.")} />}
      {link && (
        <Modal open title="Lien de mot de passe du patron" onClose={() => setLink(null)} footer={<Button onClick={() => setLink(null)}>Fermer</Button>}>
          <Alert tone="amber">À n&apos;envoyer qu&apos;après avoir vérifié l&apos;identité du demandeur. Valable 24 h, une seule fois.</Alert>
          <Input readOnly value={link.url} onFocus={(e) => e.target.select()} />
          <a
            href={`https://wa.me/${(link.owner.phone ?? "").replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Bonjour ${link.owner.firstName}, voici votre lien pour choisir un nouveau mot de passe (valable 24 h) : ${link.url}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="success">Envoyer par WhatsApp</Button>
          </a>
        </Modal>
      )}
    </>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-xs text-gray-500">{label}</p>
      {children}
    </div>
  );
}

function PaymentModal({ company, plans, onClose, onDone }: { company: Company; plans: Plan[]; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const paid = plans.filter((p) => p.code !== "TRIAL");
  const [planCode, setPlanCode] = useState(company.planCode !== "TRIAL" ? company.planCode : (paid[0]?.code ?? ""));
  const [months, setMonths] = useState("1");
  const plan = paid.find((p) => p.code === planCode);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("MOBILE_MONEY");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = Math.max(1, Number(months) || 1);
  const expected = (plan?.monthlyPrice ?? 0) * m;
  const now = new Date();
  const start = company.paidUntil && new Date(company.paidUntil) > now ? new Date(company.paidUntil) : now;
  const end = new Date(start);
  end.setMonth(end.getMonth() + m);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/platform/companies/${company.id}/payments`, { planCode, months: m, method, ...(amount ? { amount: Number(amount.replace(/\s/g, "")) } : {}), reference: reference || undefined });
      await onDone(`Paiement enregistré : abonnement ${plan?.name} jusqu'au ${end.toLocaleDateString("fr-FR")}.`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Paiement — ${company.tradeName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy} disabled={!planCode}>
            Enregistrer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Offre">
          <Select value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
            {paid.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} — {fcfa(p.monthlyPrice)}/mois
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nombre de mois">
          <Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
        </Field>
        <Field label="Montant reçu" hint={`Par défaut : ${fcfa(expected)}`}>
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(expected)} />
        </Field>
        <Field label="Moyen">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Référence (n° de transaction Mobile Money…)">
        <Input value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <p className="text-sm text-gray-600">
        Période couverte : du {start.toLocaleDateString("fr-FR")} au <strong>{end.toLocaleDateString("fr-FR")}</strong>. Un compte suspendu est réactivé.
      </p>
    </Modal>
  );
}

function SuspendModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open
      title="Suspendre le compte"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => onSubmit(reason)} disabled={reason.trim().length < 3}>
            Suspendre
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-700">Tous les utilisateurs sont déconnectés et ne peuvent plus se connecter. Les données sont conservées ; la réactivation rétablit tout.</p>
      <Field label="Motif (visible par le client)">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function SettingsModal({ company, plans, onClose, onSubmit }: { company: Company; plans: Plan[]; onClose: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const [planCode, setPlanCode] = useState(company.planCode);
  const [extend, setExtend] = useState("");
  const [maxC, setMaxC] = useState(company.customMaxCenters?.toString() ?? "");
  const [maxU, setMaxU] = useState(company.customMaxUsers?.toString() ?? "");
  const submit = () =>
    onSubmit({
      ...(planCode !== company.planCode ? { planCode } : {}),
      ...(extend ? { extendTrialDays: Number(extend) } : {}),
      customMaxCenters: maxC ? Number(maxC) : null,
      customMaxUsers: maxU ? Number(maxU) : null,
    });
  return (
    <Modal
      open
      title="Offre, essai et limites"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit}>Enregistrer</Button>
        </>
      }
    >
      <Field label="Offre" hint="Change les limites ; l'échéance ne change qu'avec un paiement.">
        <Select value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Prolonger l'essai de (jours)" hint={`Fin d'essai actuelle : ${day(company.trialEndsAt)}`}>
        <Input inputMode="numeric" value={extend} onChange={(e) => setExtend(e.target.value)} placeholder="ex. 7" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Limite de centres" hint="Vide : celle de l'offre">
          <Input inputMode="numeric" value={maxC} onChange={(e) => setMaxC(e.target.value)} placeholder={company.plan.maxCenters?.toString() ?? "illimité"} />
        </Field>
        <Field label="Limite d'utilisateurs" hint="Vide : celle de l'offre">
          <Input inputMode="numeric" value={maxU} onChange={(e) => setMaxU(e.target.value)} placeholder={company.plan.maxUsers?.toString() ?? "illimité"} />
        </Field>
      </div>
    </Modal>
  );
}
