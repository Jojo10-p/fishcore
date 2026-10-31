import { Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaff } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { Card } from "@/components/client/shared";
import { FormDialog } from "@/components/admin/form-dialog";
import { ActionButton } from "@/components/admin/small-actions";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { saveStaff, setStaffStatus, saveRolePermissions } from "@/server/actions/admin/manage";
import { PERMISSIONS, ALL_PERMISSIONS } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Administrateurs" };

type Staff = { id?: string; firstName: string; lastName: string; email: string; roleId: string | null };
function StaffFields({ s, roles, isNew }: { s: Staff; roles: { id: string; name: string; key: string }[]; isNew: boolean }) {
  return (
    <>
      {s.id && <input type="hidden" name="id" value={s.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" htmlFor="firstName"><Input id="firstName" name="firstName" defaultValue={s.firstName} required /></Field>
        <Field label="Nom" htmlFor="lastName"><Input id="lastName" name="lastName" defaultValue={s.lastName} required /></Field>
      </div>
      <Field label="Email professionnel" htmlFor="email"><Input id="email" name="email" type="email" defaultValue={s.email} required /></Field>
      <Field label="Rôle" htmlFor="roleId"><Select id="roleId" name="roleId" defaultValue={s.roleId ?? ""} required><option value="">Choisir…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <Field label={isNew ? "Mot de passe initial" : "Nouveau mot de passe (facultatif)"} htmlFor="password" hint="10 caractères min., majuscule, minuscule et chiffre. À transmettre de façon sécurisée."><Input id="password" name="password" type="password" autoComplete="new-password" required={isNew} /></Field>
    </>
  );
}

export default async function AdminUsers() {
  const me = await requireStaff("users.manage");
  const [staff, roles] = await Promise.all([
    db.user.findMany({ where: { type: "STAFF", deletedAt: null }, include: { role: true }, orderBy: [{ status: "asc" }, { lastName: "asc" }] }),
    db.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const assignable = roles.filter((r) => r.key !== "super_admin" || me.roleKey === "super_admin");
  const groups = [...new Set(Object.values(PERMISSIONS).map((p) => p.group))];
  return (
    <>
      <PageHeader title="Administrateurs" text="Comptes du back-office, rôles et permissions." actions={<FormDialog trigger="Nouvel administrateur" triggerProps={{ size: "sm" }} title="Nouvel administrateur" action={saveStaff}><StaffFields s={{ firstName: "", lastName: "", email: "", roleId: null }} roles={assignable} isNew /></FormDialog>} />
      <Card title={`Comptes (${staff.length})`} className="mb-6">
        <ul className="-my-3 divide-y divide-night/[.06]">
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1"><p className="font-medium">{s.firstName} {s.lastName}{s.id === me.id && <span className="ml-2 text-xs text-ink-faint">(vous)</span>}</p><p className="text-sm text-ink-faint">{s.email} · dernière connexion {formatDate(s.lastLoginAt, "fr-FR", true)}</p></div>
              <Badge tone={s.role?.key === "super_admin" ? "champagne" : "teal"}>{s.role?.name ?? "Sans rôle"}</Badge>
              {s.status === "ACTIVE" ? <Badge tone="green">Actif</Badge> : <Badge tone="red">Suspendu</Badge>}
              {(s.role?.key !== "super_admin" || me.roleKey === "super_admin") && (
                <>
                  <FormDialog trigger={<Pencil className="h-4 w-4" />} triggerProps={{ variant: "ghost", size: "icon", "aria-label": "Modifier" }} title={`Modifier ${s.firstName} ${s.lastName}`} action={saveStaff}><StaffFields s={s} roles={assignable} isNew={false} /></FormDialog>
                  {s.id !== me.id && (s.status === "ACTIVE"
                    ? <ActionButton size="sm" variant="ghost" run={setStaffStatus.bind(null, s.id, "SUSPENDED")} confirm={{ title: "Suspendre ce compte ?", description: "Ses sessions seront fermées immédiatement.", label: "Suspendre", danger: true }}>Suspendre</ActionButton>
                    : <ActionButton size="sm" variant="ghost" run={setStaffStatus.bind(null, s.id, "ACTIVE")}>Réactiver</ActionButton>)}
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Rôles et permissions">
        {!me.can("roles.manage") && <p className="mb-4 text-sm text-ink-faint">Lecture seule — la modification des rôles est réservée au super administrateur.</p>}
        <div className="space-y-4">
          {roles.map((r) => {
            const set = new Set(r.permissions.map((p) => p.key));
            const locked = r.key === "super_admin" || !me.can("roles.manage");
            return (
              <details key={r.id} className="group rounded-xl border border-night/[.08]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span><span className="font-semibold">{r.name}</span><span className="ml-2 text-sm text-ink-faint">{r.description}</span></span>
                  <span className="tabular shrink-0 text-sm text-ink-faint">{set.size}/{ALL_PERMISSIONS.length} · {r._count.users} compte(s)</span>
                </summary>
                <div className="border-t border-night/[.06] p-4">
                  {(() => { const matrix = (
                    <fieldset disabled={locked} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {groups.map((g) => (
                        <div key={g}>
                          <p className="mb-2 text-sm font-semibold">{g}</p>
                          <ul className="space-y-1.5">
                            {ALL_PERMISSIONS.filter((k) => PERMISSIONS[k].group === g).map((k) => (
                              <li key={k}><label className="flex items-start gap-2 text-sm"><Checkbox name={`p:${k}`} defaultChecked={set.has(k)} className="mt-0.5" />{PERMISSIONS[k].label}</label></li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </fieldset>
                  );
                  return locked ? matrix : (
                    <ActionForm action={saveRolePermissions} submitLabel="Enregistrer les permissions" variant="outline">
                      <input type="hidden" name="roleId" value={r.id} />
                      {matrix}
                    </ActionForm>
                  ); })()}
                </div>
              </details>
            );
          })}
        </div>
      </Card>
    </>
  );
}
