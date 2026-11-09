"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  centers: Array<{ center: { id: string; name: string; code: string } }>;
}

const ROLES: Record<string, string> = {
  COMPANY_OWNER: "Propriétaire",
  CENTER_MANAGER: "Gérant",
  CASHIER: "Caissier",
  ACCOUNTANT: "Comptable",
  STOCK_MANAGER: "Magasinier",
  SALES_EMPLOYEE: "Employé vendeur",
};

export default function UsersPage() {
  const { can, session, centerId: currentCenterId } = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [inviteKey, setInviteKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ data: UserRow[] }>("/api/users");
      setUsers(res.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        description="Chaque employé crée son propre compte, puis rejoint GJH avec le code (ou le lien) que vous lui donnez."
        actions={can("user:create") && <Button onClick={() => setCreating(true)}>+ Ajouter un utilisateur</Button>}
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        {!users ? (
          <Spinner />
        ) : users.length === 0 ? (
          <EmptyState icon="👥" title="Aucun utilisateur" />
        ) : (
          <Table head={["Nom", "Rôle", "Centres", "Dernière connexion", "Statut", ""]}>
            {users.map((u) => (
              <tr key={u.id}>
                <Td>
                  <p className="font-medium">
                    {u.firstName} {u.lastName}
                  </p>
                  <p className="text-xs text-gray-500">{u.email}</p>
                </Td>
                <Td>{ROLES[u.role] ?? u.role}</Td>
                <Td className="whitespace-normal">{u.role === "COMPANY_OWNER" ? "Tous" : u.centers.map((c) => c.center.name).join(", ") || "—"}</Td>
                <Td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "Jamais"}</Td>
                <Td>{u.isActive ? <Badge tone="green">Actif</Badge> : <Badge tone="red">Désactivé</Badge>}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    {can("user:edit") && u.isActive && u.id !== session?.user.id && (u.role !== "COMPANY_OWNER" || session?.user.role === "COMPANY_OWNER") && (
                      <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => setResetFor(u)}>
                        🔑 Mot de passe
                      </Button>
                    )}
                    {can("user:edit") && (u.role !== "COMPANY_OWNER" || session?.user.role === "COMPANY_OWNER") && (
                      <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => setEditing(u)}>
                        Modifier
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && session && (
        <EditUserModal
          user={editing}
          self={editing.id === session.user.id}
          centers={session.centers}
          isOwner={session.user.role === "COMPANY_OWNER"}
          canDeactivate={can("user:deactivate")}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      {resetFor && <ResetLinkModal user={resetFor} onClose={() => setResetFor(null)} />}
      <PendingInvites refreshKey={inviteKey} canRevoke={can("user:create")} />
      {creating && session && (
        <InviteModal
          centers={session.centers}
          currentCenterId={currentCenterId}
          isOwner={session.user.role === "COMPANY_OWNER"}
          onClose={() => {
            setCreating(false);
            void load();
          }}
          onCreated={() => setInviteKey((k) => k + 1)}
        />
      )}
    </>
  );
}

interface PendingInvite {
  id: string;
  role: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  center: { name: string } | null;
  createdBy: { firstName: string } | null;
}

/** Liens d'invitation pas encore utilisés. */
function PendingInvites({ refreshKey, canRevoke }: { refreshKey: number; canRevoke: boolean }) {
  const [list, setList] = useState<PendingInvite[] | null>(null);
  const load = useCallback(async () => {
    try {
      setList((await apiGet<{ data: PendingInvite[] }>("/api/invitations")).data);
    } catch {
      setList([]);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, refreshKey]);
  if (!list || list.length === 0) return null;
  return (
    <Card className="mt-6">
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">Invitations en attente</h2>
        <p className="text-sm text-gray-500">Liens envoyés, pas encore utilisés pour créer un compte.</p>
      </div>
      <Table head={["Pour", "Poste", "Boutique", "Expire le", ""]}>
        {list.map((i) => (
          <tr key={i.id}>
            <Td>{i.label || "—"}</Td>
            <Td>{ROLES[i.role] ?? i.role}</Td>
            <Td>{i.center?.name ?? "Toutes"}</Td>
            <Td>{new Date(i.expiresAt).toLocaleDateString("fr-FR")}</Td>
            <Td className="text-right">
              {canRevoke && (
                <Button
                  variant="ghost"
                  className="px-2 py-1.5 text-xs text-red-600"
                  onClick={async () => {
                    if (!window.confirm("Annuler ce lien ? Il ne pourra plus servir.")) return;
                    await apiSend(`/api/invitations/${i.id}`, {}, "DELETE").catch(() => undefined);
                    await load();
                  }}
                >
                  Annuler
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function InviteModal({
  centers,
  currentCenterId,
  isOwner,
  onClose,
  onCreated,
}: {
  centers: Array<{ id: string; name: string }>;
  currentCenterId?: string | null;
  isOwner: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [role, setRole] = useState("CASHIER");
  // Le code est fait pour la boutique ouverte (huile d'arachide ou huile de moteur)
  const [centerId, setCenterId] = useState(currentCenterId ?? centers[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<"code" | "link">("code");
  const [link, setLink] = useState<{ url?: string; code?: string; signupUrl?: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!link?.code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [link]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { url?: string; code?: string; signupUrl?: string; expiresAt: string } }>("/api/invitations", { role, centerId: role === "COMPANY_OWNER" ? undefined : centerId, label: label || undefined, kind });
      setLink(res.data);
      onCreated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const roleName = (ROLES[role] ?? role).toLowerCase();
  const hello = `Bonjour${label ? ` ${label}` : ""}`;
  const message = !link
    ? ""
    : link.code
      ? `${hello}, pour rejoindre GJH Gestion comme ${roleName} : ouvrez ${link.signupUrl}, tapez le code ${link.code}, puis créez votre compte (valable 30 minutes, une seule fois).`
      : `${hello}, voici votre lien pour créer votre compte GJH Gestion (${roleName}) : ${link.url}\nValable 7 jours, une seule fois.`;
  const left = link ? Math.max(0, new Date(link.expiresAt).getTime() - now) : 0;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
  const digits = phone.replace(/[^0-9]/g, "");

  return (
    <Modal open onClose={onClose} title="Ajouter un utilisateur" footer={<Button variant="secondary" onClick={onClose}>Fermer</Button>}>
      {error && <Alert>{error}</Alert>}
      {!link ? (
        <>
          <p className="text-sm text-gray-700">
            Choisissez le poste, puis générez le code. La personne le tape dans « Me rattacher avec un code » et crée son compte : elle a automatiquement les accès de ce poste, rien de plus. Vous ne connaissez jamais son mot de passe.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {([["code", "🔢 Code à taper", "30 min — de vive voix ou par message"], ["link", "🔗 Lien WhatsApp", "7 jours — crée le compte en un clic"]] as const).map(([k, t, d]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-xl border p-3 text-left text-sm ${kind === k ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
              >
                <span className="block font-semibold text-gray-900">{t}</span>
                <span className="block text-xs text-gray-500">{d}</span>
              </button>
            ))}
          </div>
          <Field label="Poste">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {["CASHIER", "CENTER_MANAGER", "STOCK_MANAGER", "ACCOUNTANT", ...(isOwner ? ["COMPANY_OWNER"] : [])].map((k) => (
                <option key={k} value={k}>
                  {ROLES[k]}
                </option>
              ))}
            </Select>
          </Field>
          {role !== "COMPANY_OWNER" && centers.length > 1 && (
            <Field label="Boutique" hint="Le code ne marchera que pour cette boutique.">
              <Select value={centerId} onChange={(e) => setCenterId(e.target.value)}>
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Prénom de la personne (facultatif)" hint="Pour vous y retrouver et pré-remplir son compte.">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Rachidi" />
          </Field>
          <Field label="Son numéro WhatsApp (facultatif)" hint="Pour ouvrir WhatsApp directement sur sa conversation.">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="ex. 22997000000" />
          </Field>
          <Button onClick={create} loading={busy} disabled={role !== "COMPANY_OWNER" && !centerId}>
            {kind === "code" ? "Générer le code" : "Générer le lien"}
          </Button>
        </>
      ) : (
        <>
          {link.code ? (
            <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-5 text-center">
              <p className="text-sm text-gray-700">Code pour {label || "la personne"} ({roleName})</p>
              <p className="my-2 select-all font-mono text-4xl font-bold tracking-[0.2em] text-gray-900">{link.code}</p>
              <p className={`text-sm ${left > 0 ? "text-gray-600" : "font-semibold text-red-600"}`}>{left > 0 ? `Expire dans ${mmss}` : "Code expiré : créez-en un nouveau"}</p>
              <p className="mt-3 text-xs text-gray-500">Sur {link.signupUrl}, la personne touche « Me rattacher avec un code », tape ce code puis crée son compte. Il sert une seule fois.</p>
            </div>
          ) : (
            <>
              <Alert tone="green">Lien prêt. Envoyez-le à {label || "la personne"} : il sert une seule fois et expire dans 7 jours.</Alert>
              <Input readOnly value={link.url} onFocus={(e) => e.target.select()} />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={`https://wa.me/${digits}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
              <Button variant="success">Envoyer par WhatsApp</Button>
            </a>
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(message).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? "✓ Copié" : "Copier le message"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function EditUserModal({
  user,
  self,
  centers,
  isOwner,
  canDeactivate,
  onClose,
  onSaved,
}: {
  user: UserRow;
  self: boolean;
  centers: Array<{ id: string; name: string }>;
  isOwner: boolean;
  canDeactivate: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({ firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? "", role: user.role });
  const [centerIds, setCenterIds] = useState<string[]>(user.centers.map((c) => c.center.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/users/${user.id}`, body, "PATCH");
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const toggle = () => {
    const msg = user.isActive
      ? `Désactiver le compte de ${user.firstName} ? Il sera déconnecté de tous ses appareils et ne pourra plus se connecter.`
      : `Réactiver le compte de ${user.firstName} ?`;
    if (window.confirm(msg)) void send({ isActive: !user.isActive });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Modifier ${user.firstName} ${user.lastName}`}
      footer={
        <>
          {canDeactivate && !self && (
            <Button variant={user.isActive ? "ghost" : "success"} className={user.isActive ? "mr-auto text-red-600" : "mr-auto"} onClick={toggle} disabled={busy}>
              {user.isActive ? "Désactiver le compte" : "Réactiver le compte"}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() => send({ ...form, phone: form.phone || null, ...(self ? { role: undefined } : {}), ...(form.role === "COMPANY_OWNER" ? {} : { centerIds }) })}
            loading={busy}
            disabled={!form.firstName || (form.role !== "COMPANY_OWNER" && centerIds.length === 0)}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-gray-500">{user.email}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prénom">
          <Input value={form.firstName} onChange={set("firstName")} />
        </Field>
        <Field label="Nom">
          <Input value={form.lastName} onChange={set("lastName")} />
        </Field>
      </div>
      <Field label="Téléphone">
        <Input value={form.phone} onChange={set("phone")} />
      </Field>
      <Field label="Rôle" hint={self ? "Vous ne pouvez pas changer votre propre rôle." : undefined}>
        <Select value={form.role} onChange={set("role")} disabled={self}>
          {Object.entries(ROLES)
            .filter(([k]) => k !== "COMPANY_OWNER" || isOwner)
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Select>
      </Field>
      {form.role !== "COMPANY_OWNER" && (
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 mb-1">Centres autorisés</legend>
          <div className="flex flex-wrap gap-3">
            {centers.map((c) => (
              <label key={c.id} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={centerIds.includes(c.id)}
                  onChange={(e) => setCenterIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </Modal>
  );
}

function ResetLinkModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { url: string; expiresAt: string } }>(`/api/users/${user.id}/reset-link`, {});
      setLink(res.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const message = link ? `Bonjour ${user.firstName}, voici votre lien pour choisir un nouveau mot de passe (valable 24 h, une seule fois) : ${link.url}` : "";
  const phone = (user.phone ?? "").replace(/[^0-9]/g, "");

  return (
    <Modal open onClose={onClose} title={`Mot de passe de ${user.firstName} ${user.lastName}`} footer={<Button variant="secondary" onClick={onClose}>Fermer</Button>}>
      {error && <Alert>{error}</Alert>}
      {!link ? (
        <>
          <p className="text-sm text-gray-700">
            Générez un lien personnel à envoyer à {user.firstName} par WhatsApp ou SMS. En l&apos;ouvrant, il choisit lui-même son nouveau mot de passe ; vous ne
            le connaissez jamais. Le lien sert une seule fois et expire après 24 heures.
          </p>
          <Button onClick={generate} loading={busy}>
            Générer le lien
          </Button>
        </>
      ) : (
        <>
          <Alert tone="green">Lien prêt. Tout lien généré auparavant pour ce compte ne fonctionne plus.</Alert>
          <Input readOnly value={link.url} onFocus={(e) => e.target.select()} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(message).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? "✓ Copié" : "Copier le message"}
            </Button>
            <a href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
              <Button variant="success">Envoyer par WhatsApp</Button>
            </a>
            {phone && (
              <a href={`sms:${user.phone}?body=${encodeURIComponent(message)}`}>
                <Button variant="secondary">SMS</Button>
              </a>
            )}
          </div>
          <p className="text-xs text-gray-500">Expire le {new Date(link.expiresAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.</p>
        </>
      )}
    </Modal>
  );
}
