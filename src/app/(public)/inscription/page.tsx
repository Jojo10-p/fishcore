import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/site/auth-shell";
import { AuthForm } from "@/components/forms/auth-form";
import { register } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth/session";

export const metadata = { title: "Créer un compte", robots: { index: false } };

export default async function RegisterPage() {
  if ((await getCurrentUser())?.type === "CUSTOMER") redirect("/espace");
  return (
    <AuthShell
      title="Créer votre espace"
      text="Un espace unique pour vos demandes, vos documents et vos échanges avec notre équipe."
      aside={<p className="max-w-sm font-display text-2xl font-semibold leading-snug">Nous ne vous demanderons jamais de paiement pour étudier une demande.</p>}
      footer={<>Déjà inscrit ? <Link href="/connexion" className="font-semibold text-teal-700 hover:underline">Se connecter</Link></>}
    >
      <AuthForm
        action={register}
        submitLabel="Créer mon espace"
        fields={[
          { name: "firstName", label: "Prénoms", autoComplete: "given-name", half: true },
          { name: "lastName", label: "Nom", autoComplete: "family-name", half: true },
          { name: "email", label: "Email", type: "email", autoComplete: "email", half: true },
          { name: "phone", label: "Téléphone", type: "tel", autoComplete: "tel", half: true },
          { name: "password", label: "Mot de passe", type: "password", autoComplete: "new-password", hint: "10 caractères min., majuscule, minuscule et chiffre", half: true },
          { name: "passwordConfirm", label: "Confirmation", type: "password", autoComplete: "new-password", half: true },
        ]}
        consent={<>J'accepte le traitement de mes données conformément à la <Link href="/confidentialite" className="font-semibold text-teal-700 underline">politique de confidentialité</Link>.</>}
      />
    </AuthShell>
  );
}
