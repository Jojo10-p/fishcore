import { AuthShell } from "@/components/site/auth-shell";
import { AuthForm } from "@/components/forms/auth-form";
import { resetPassword } from "@/server/actions/auth";

export const metadata = { title: "Nouveau mot de passe", robots: { index: false } };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell title="Nouveau mot de passe" text="Choisissez un mot de passe que vous n'utilisez sur aucun autre site.">
      <AuthForm action={resetPassword} submitLabel="Enregistrer" hidden={{ token }} fields={[{ name: "password", label: "Nouveau mot de passe", type: "password", autoComplete: "new-password", hint: "10 caractères min., majuscule, minuscule et chiffre" }, { name: "passwordConfirm", label: "Confirmation", type: "password", autoComplete: "new-password" }]} />
    </AuthShell>
  );
}
