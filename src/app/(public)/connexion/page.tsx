import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/site/auth-shell";
import { AuthForm } from "@/components/forms/auth-form";
import { FormStatus } from "@/components/ui/form-status";
import { customerLogin } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth/session";

export const metadata = { title: "Connexion", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const u = await getCurrentUser();
  if (u?.type === "CUSTOMER") redirect("/espace");
  return (
    <AuthShell
      title="Espace client"
      text="Connectez-vous pour suivre vos demandes et transmettre vos justificatifs."
      aside={<p className="max-w-sm font-display text-2xl font-semibold leading-snug">Chaque étape de l'étude de votre dossier, datée et visible.</p>}
      footer={<>Pas encore de compte ? <Link href="/inscription" className="font-semibold text-teal-700 hover:underline">Créer un espace</Link> ou <Link href="/demande" className="font-semibold text-teal-700 hover:underline">déposer une demande</Link>.</>}
    >
      {sp.reset && <div className="mb-5"><FormStatus state={{ ok: true, message: "Mot de passe modifié. Vous pouvez vous connecter." }} /></div>}
      <AuthForm action={customerLogin} submitLabel="Se connecter" hidden={{ next: sp.next ?? "/espace" }} fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }, { name: "password", label: "Mot de passe", type: "password", autoComplete: "current-password" }]} />
      <Link href="/mot-de-passe-oublie" className="mt-4 inline-block text-sm text-ink-soft hover:text-ink">Mot de passe oublié ?</Link>
    </AuthShell>
  );
}
