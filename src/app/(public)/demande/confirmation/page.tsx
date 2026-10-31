import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demande envoyée", robots: { index: false } };

export default async function ConfirmationPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  const user = await getCurrentUser();
  if (!ref || !user?.customer) notFound();
  const app = await db.loanApplication.findFirst({ where: { reference: ref, customerId: user.customer.id }, include: { documentRequests: { where: { fulfilledAt: null } } } });
  if (!app) notFound();
  return (
    <section className="container max-w-2xl py-16 text-center">
      <CheckCircle2 className="mx-auto h-14 w-14 text-teal" strokeWidth={1.5} />
      <h1 className="mt-6 text-4xl font-extrabold">Demande envoyée</h1>
      <p className="mt-4 text-lg text-ink-soft">Votre dossier est enregistré sous la référence</p>
      <p className="tabular mt-3 inline-block rounded-2xl bg-night px-6 py-3 font-display text-2xl font-bold tracking-wider text-champagne">{app.reference}</p>
      <p className="mx-auto mt-6 max-w-lg text-ink-soft">Un email de confirmation vous a été adressé. Vous serez informé(e) de chaque étape de l'étude dans votre espace client.</p>
      {app.documentRequests.length > 0 && <p className="mx-auto mt-4 max-w-lg rounded-2xl bg-[#FDF3E2] p-4 text-sm text-[#7A4F0E]">{app.documentRequests.length} justificatif(s) restent à transmettre depuis votre espace pour lancer l'étude.</p>}
      <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
        <Link href={`/espace/demandes/${app.id}`} className={buttonVariants({ size: "lg" })}>Suivre ma demande</Link>
        <Link href="/" className={buttonVariants({ size: "lg", variant: "outline" })}>Retour à l'accueil</Link>
      </div>
    </section>
  );
}
