"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui";
import {
  ago,
  day,
  fcfa,
  metier,
  StateBadge,
} from "@/components/platform/shell";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface Center {
  id: string;
  name: string;
  code: string;
  status: string;
  city: string | null;
  createdAt: string;
  sales30d: number;
  revenue30d: number;
  lastSaleAt: string | null;
  registers: number;
  openSessions: number;
  users: number;
  stockArticles: number;
  stockValue: number;
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
  logoUrl: string | null;
  createdAt: string;
  isActive: boolean;
  inactive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  platformNotes: string | null;
  centers: Center[];
  users: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
    centers: Array<{ centerId: string }>;
  }>;
  _count: { products: number; customers: number; suppliers: number };
  activity: {
    sales30d: number;
    revenue30d: number;
    lastSaleAt: string | null;
    lastLoginAt: string | null;
    lastActivityAt: string | null;
  };
  daily: Array<{ day: string; count: number; amount: number }>;
}

const ROLES: Record<string, string> = {
  COMPANY_OWNER: "Propriétaire",
  CENTER_MANAGER: "Gérant",
  CASHIER: "Caissier",
  ACCOUNTANT: "Comptable",
  STOCK_MANAGER: "Magasinier",
  SALES_EMPLOYEE: "Vendeur",
};

export default function PlatformCompany() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [link, setLink] = useState<{
    url: string;
    owner: { firstName: string; phone: string | null };
  } | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ data: Company }>(
        `/api/platform/companies/${id}`,
      );
      setC(r.data);
      setNotes(r.data.platformNotes ?? "");
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
      const r = await apiSend<{ data: Company }>(
        `/api/platform/companies/${id}`,
        body,
        "PATCH",
      );
      setC(r.data);
      setNotice(msg);
      setSuspendOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const resetLink = async () => {
    try {
      const r = await apiSend<{
        data: {
          url: string;
          owner: { firstName: string; phone: string | null };
        };
      }>(`/api/platform/companies/${id}/reset-link`, {});
      setLink(r.data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (error && !c) return <Alert>{error}</Alert>;
  if (!c) return <Spinner />;
  const maxDay = Math.max(1, ...c.daily.map((d) => d.amount));
  const activeUsers = c.users.filter((u) => u.isActive).length;

  return (
    <>
      <PageHeader
        title={c.tradeName}
        description={`${metier(c.businessType)} · ${c.ownerName} · ${c.phone} · ${c.email}${c.city ? ` · ${c.city}` : ""} · inscrite le ${day(c.createdAt)}`}
        actions={
          <Link href="/plateforme/clients">
            <Button variant="secondary">← Entreprises</Button>
          </Link>
        }
      />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="green">{notice}</Alert>}
      {!c.isActive && (
        <Alert tone="amber">
          Suspendue le {day(c.suspendedAt)} : {c.suspendedReason}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Box label="État">
          <StateBadge isActive={c.isActive} inactive={c.inactive} />
          <p className="mt-1 text-xs text-gray-500">
            dernière activité {ago(c.activity.lastActivityAt)}
          </p>
        </Box>
        <Box label="Centres (filiales)">
          <p className="text-xl font-bold">{c.centers.length}</p>
          <p className="text-xs text-gray-500">
            {c.centers.filter((x) => x.status === "ACTIVE").length} actif(s)
          </p>
        </Box>
        <Box label="Utilisateurs">
          <p className="text-xl font-bold">{activeUsers}</p>
          <p className="text-xs text-gray-500">
            dernière connexion {ago(c.activity.lastLoginAt)}
          </p>
        </Box>
        <Box label="Ventes (30 jours)">
          <p className="text-xl font-bold">{c.activity.sales30d}</p>
          <p className="text-xs text-gray-500">{fcfa(c.activity.revenue30d)}</p>
        </Box>
      </div>

      <Card className="mt-6 p-4">
        <h2 className="font-semibold text-gray-900">
          Chiffre d&apos;affaires jour par jour (30 jours)
        </h2>
        <div className="mt-4 flex h-28 items-end gap-0.5">
          {c.daily.map((d) => (
            <div
              key={d.day}
              title={`${day(d.day)} : ${d.count} vente(s), ${fcfa(d.amount)}`}
              className="flex-1 rounded-t bg-blue-500"
              style={{
                height: `${(d.amount / maxDay) * 100}%`,
                minHeight: d.amount ? 3 : 1,
                opacity: d.amount ? 1 : 0.15,
              }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-500">
          <span>{day(c.daily[0]?.day)}</span>
          <span>aujourd&apos;hui</span>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="px-4 pt-4 font-semibold text-gray-900">
              Centres (filiales)
            </h2>
            <div className="overflow-x-auto">
              <table className="mt-2 min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2 font-medium">Centre</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Ventes 30 j
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Stock</th>
                    <th className="px-4 py-2 text-center font-medium">
                      Caisses
                    </th>
                    <th className="px-4 py-2 text-center font-medium">
                      Équipe
                    </th>
                    <th className="px-4 py-2 font-medium">Dernière vente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {c.centers.map((x) => (
                    <tr key={x.id}>
                      <td className="px-4 py-2">
                        <p className="font-medium text-gray-900">
                          {x.name}{" "}
                          <span className="text-xs text-gray-500">
                            ({x.code})
                          </span>
                        </p>
                        <p className="text-xs text-gray-500">
                          {x.city ? `${x.city} · ` : ""}créé le{" "}
                          {day(x.createdAt)}
                          {x.status !== "ACTIVE" && (
                            <span className="ml-1 text-amber-700">· fermé</span>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <p className="font-medium">{x.sales30d}</p>
                        <p className="text-xs text-gray-500">
                          {fcfa(x.revenue30d)}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <p>{x.stockArticles} art.</p>
                        <p className="text-xs text-gray-500">
                          {fcfa(x.stockValue)}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-center">
                        {x.registers}
                        {x.openSessions > 0 && (
                          <span className="ml-1 text-xs text-green-700">
                            ({x.openSessions} ouverte)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">{x.users}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {ago(x.lastSaleAt)}
                      </td>
                    </tr>
                  ))}
                  {c.centers.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-gray-500"
                      >
                        Aucun centre créé.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold text-gray-900">Utilisateurs</h2>
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {c.users.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-wrap justify-between gap-x-3 py-2"
                >
                  <span>
                    <span className="font-medium">
                      {u.firstName} {u.lastName}
                    </span>{" "}
                    <span className="text-gray-500">
                      · {ROLES[u.role] ?? u.role} · {u.email}
                      {u.role !== "COMPANY_OWNER" &&
                        u.centers.length > 0 &&
                        ` · ${u.centers.map((uc) => c.centers.find((x) => x.id === uc.centerId)?.code ?? "?").join(", ")}`}
                    </span>
                    {!u.isActive && (
                      <span className="ml-1 text-xs text-red-600">
                        désactivé
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-gray-500">
                    connexion {ago(u.lastLoginAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold text-gray-900">Actions</h2>
            <Button variant="secondary" className="w-full" onClick={resetLink}>
              🔑 Lien de mot de passe du propriétaire
            </Button>
            {c.isActive ? (
              <Button
                variant="danger"
                className="w-full"
                onClick={() => setSuspendOpen(true)}
              >
                Suspendre le compte
              </Button>
            ) : (
              <Button
                variant="success"
                className="w-full"
                onClick={() =>
                  void patch({ reactivate: true }, "Compte réactivé.")
                }
              >
                Réactiver le compte
              </Button>
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold text-gray-900">Notes internes</h2>
            <p className="text-xs text-gray-500">
              Jamais visibles par le client.
            </p>
            <Textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Prix convenu, date d'installation, contact…"
            />
            <Button
              variant="secondary"
              onClick={() =>
                void patch(
                  { platformNotes: notes || null },
                  "Notes enregistrées.",
                )
              }
            >
              Enregistrer les notes
            </Button>
          </Card>
          <Card className="space-y-1 p-4 text-sm text-gray-600">
            <h2 className="mb-1 font-semibold text-gray-900">Fiche</h2>
            {c.legalName && <p>Raison sociale : {c.legalName}</p>}
            <p>IFU : {c.taxId ?? "—"}</p>
            {c.address && <p>Adresse : {c.address}</p>}
            <p>
              {c._count.products} article(s) · {c._count.customers} client(s) ·{" "}
              {c._count.suppliers} fournisseur(s)
            </p>
          </Card>
        </div>
      </div>

      {suspendOpen && (
        <SuspendModal
          onClose={() => setSuspendOpen(false)}
          onSubmit={(reason) =>
            patch(
              { suspend: { reason } },
              "Compte suspendu : tous ses utilisateurs ont été déconnectés.",
            )
          }
        />
      )}
      {link && (
        <Modal
          open
          title="Lien de mot de passe du propriétaire"
          onClose={() => setLink(null)}
          footer={<Button onClick={() => setLink(null)}>Fermer</Button>}
        >
          <Alert tone="amber">
            À n&apos;envoyer qu&apos;après avoir vérifié l&apos;identité du
            demandeur. Valable 24 h, une seule fois.
          </Alert>
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

function Box({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-xs text-gray-500">{label}</p>
      {children}
    </div>
  );
}

function SuspendModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
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
          <Button
            variant="danger"
            onClick={() => onSubmit(reason)}
            disabled={reason.trim().length < 3}
          >
            Suspendre
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-700">
        Tous les utilisateurs sont déconnectés et ne peuvent plus se connecter.
        Les données sont conservées ; la réactivation rétablit tout.
      </p>
      <Field label="Motif (visible par le client)">
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
