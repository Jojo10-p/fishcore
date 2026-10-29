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
  CENTER_MANAGER: "Gérant de centre",
  CASHIER: "Caissier",
  ACCOUNTANT: "Comptable",
  STOCK_MANAGER: "Gestionnaire de stock",
  SALES_EMPLOYEE: "Employé vendeur",
};

export default function UsersPage() {
  const { can, session } = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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
        description="Chaque employé a son propre compte : les identifiants ne se partagent jamais."
        actions={can("user:create") && <Button onClick={() => setCreating(true)}>Nouvel utilisateur</Button>}
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        {!users ? (
          <Spinner />
        ) : users.length === 0 ? (
          <EmptyState icon="👥" title="Aucun utilisateur" />
        ) : (
          <Table head={["Nom", "Rôle", "Centres", "Dernière connexion", "Statut"]}>
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
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && session && (
        <CreateUserModal
          centers={session.centers}
          isOwner={session.user.role === "COMPANY_OWNER"}
          onClose={() => setCreating(false)}
          onCreated={load}
        />
      )}
    </>
  );
}

function CreateUserModal({
  centers,
  isOwner,
  onClose,
  onCreated,
}: {
  centers: Array<{ id: string; name: string }>;
  isOwner: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", role: "CASHIER", password: "" });
  const [centerIds, setCenterIds] = useState<string[]>(centers.length === 1 ? [centers[0].id] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/users", { ...form, phone: form.phone || undefined, centerIds });
      await onCreated();
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
      title="Nouvel utilisateur"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy} disabled={!form.firstName || !form.email || !form.password || centerIds.length === 0}>
            Créer le compte
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prénom">
          <Input value={form.firstName} onChange={set("firstName")} />
        </Field>
        <Field label="Nom">
          <Input value={form.lastName} onChange={set("lastName")} />
        </Field>
      </div>
      <Field label="Email (identifiant de connexion)">
        <Input type="email" value={form.email} onChange={set("email")} />
      </Field>
      <Field label="Téléphone">
        <Input value={form.phone} onChange={set("phone")} />
      </Field>
      <Field label="Rôle">
        <Select value={form.role} onChange={set("role")}>
          {Object.entries(ROLES)
            .filter(([k]) => k !== "COMPANY_OWNER" || isOwner)
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Select>
      </Field>
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
      <Field label="Mot de passe provisoire" hint="8 caractères minimum, dont une majuscule et un chiffre. À transmettre en main propre.">
        <Input type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
      </Field>
    </Modal>
  );
}
