import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { AuthForm } from "@/components/forms/auth-form";
import { FormStatus } from "@/components/ui/form-status";
import { staffLogin } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth/session";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Back-office", robots: { index: false, follow: false } };

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const sp = await searchParams;
  if ((await getCurrentUser())?.type === "STAFF") redirect("/admin");
  const s = await getSettings();
  return (
    <div className="grid min-h-screen place-items-center bg-night px-4 py-10">
      <div className="grain pointer-events-none fixed inset-0" aria-hidden />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo name={s.org.name} invert /></div>
        <div className="rounded-[24px] bg-white p-7 shadow-lift sm:p-9">
          <h1 className="text-2xl font-extrabold">Back-office</h1>
          <p className="mt-1 text-sm text-ink-soft">Accès réservé aux équipes habilitées. Toutes les actions sont journalisées.</p>
          <div className="mt-7">
            {sp.reset && <div className="mb-5"><FormStatus state={{ ok: true, message: "Mot de passe modifié." }} /></div>}
            <AuthForm action={staffLogin} submitLabel="Se connecter" hidden={{ next: "/admin" }} fields={[{ name: "email", label: "Email professionnel", type: "email", autoComplete: "username" }, { name: "password", label: "Mot de passe", type: "password", autoComplete: "current-password" }]} />
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-white/50"><Link href="/mot-de-passe-oublie" className="hover:text-white">Mot de passe oublié</Link> · <Link href="/" className="hover:text-white">Retour au site</Link></p>
      </div>
    </div>
  );
}
