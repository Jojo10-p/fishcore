import { requireCustomer } from "@/server/auth/session";
import { PageHeader } from "@/components/client/app-shell";
import { Card } from "@/components/client/shared";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input, Checkbox } from "@/components/ui/field";
import { updateProfile, changePassword, updateNotificationPrefs } from "@/server/actions/customer";

export default async function ProfilePage() {
  const user = await requireCustomer();
  const c = user.customer;
  return (
    <>
      <PageHeader title="Mon profil" text="Vos informations personnelles et préférences." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Informations personnelles" className="lg:col-span-2">
          <ActionForm action={updateProfile} submitLabel="Enregistrer les modifications" fieldLabels={{ firstName: "Prénoms", lastName: "Nom", phone: "Téléphone" }}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Prénoms" htmlFor="firstName"><Input id="firstName" name="firstName" defaultValue={c.firstName} autoComplete="given-name" /></Field>
              <Field label="Nom" htmlFor="lastName"><Input id="lastName" name="lastName" defaultValue={c.lastName} autoComplete="family-name" /></Field>
              <Field label="Email" htmlFor="email" hint="Pour modifier votre email, contactez l'assistance."><Input id="email" value={user.email} readOnly disabled /></Field>
              <Field label="Téléphone" htmlFor="phone"><Input id="phone" name="phone" defaultValue={c.phone} autoComplete="tel" /></Field>
              <Field label="Adresse" htmlFor="address" className="sm:col-span-2"><Input id="address" name="address" defaultValue={c.address} autoComplete="street-address" /></Field>
              <Field label="Ville" htmlFor="city"><Input id="city" name="city" defaultValue={c.city} /></Field>
              <Field label="Pays" htmlFor="country"><Input id="country" name="country" defaultValue={c.country} /></Field>
              <Field label="Profession" htmlFor="profession"><Input id="profession" name="profession" defaultValue={c.profession ?? ""} /></Field>
              <Field label="Employeur" htmlFor="employer"><Input id="employer" name="employer" defaultValue={c.employer ?? ""} /></Field>
            </div>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card title="Mot de passe">
            <ActionForm action={changePassword} submitLabel="Modifier le mot de passe" resetOnSuccess variant="outline" fieldLabels={{ currentPassword: "Mot de passe actuel", newPassword: "Nouveau", confirmPassword: "Confirmation" }}>
              <Field label="Mot de passe actuel" htmlFor="currentPassword"><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" /></Field>
              <Field label="Nouveau mot de passe" htmlFor="newPassword" hint="10 caractères min., majuscule, minuscule et chiffre"><Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" /></Field>
              <Field label="Confirmation" htmlFor="confirmPassword"><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" /></Field>
            </ActionForm>
          </Card>
          <Card title="Notifications">
            <ActionForm action={updateNotificationPrefs} submitLabel="Enregistrer" variant="outline">
              <label className="flex items-center gap-3 text-[15px]"><Checkbox name="notifyByEmail" defaultChecked={user.notifyByEmail} />Recevoir les mises à jour par email</label>
              <label className="flex items-center gap-3 text-[15px]"><Checkbox name="notifyInApp" defaultChecked={user.notifyInApp} />Notifications dans mon espace</label>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
