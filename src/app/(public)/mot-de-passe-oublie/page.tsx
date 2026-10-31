import Link from "next/link";
import { AuthShell } from "@/components/site/auth-shell";
import { AuthForm } from "@/components/forms/auth-form";
import { requestPasswordReset } from "@/server/actions/auth";

export const metadata = { title: "Mot de passe oublié", robots: { index: false } };

export default function ForgotPage() {
  return (
    <AuthShell title="Mot de passe oublié" text="Indiquez l'email de votre compte : nous vous enverrons un lien valable une heure." footer={<Link href="/connexion" className="font-semibold text-teal-700 hover:underline">Retour à la connexion</Link>}>
      <AuthForm action={requestPasswordReset} submitLabel="Envoyer le lien" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]} />
    </AuthShell>
  );
}
