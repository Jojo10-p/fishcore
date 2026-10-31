import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <Link href="/" className="inline-block"><Logo /></Link>
        <p className="mt-10 font-display text-7xl font-extrabold text-night/10">404</p>
        <h1 className="mt-2 text-2xl font-bold">Cette page n'existe pas</h1>
        <p className="mt-2 text-ink-soft">Le lien est peut-être incomplet, ou la page a été déplacée.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/" className={buttonVariants()}>Retour à l'accueil</Link>
          <Link href="/contact" className={buttonVariants({ variant: "outline" })}>Nous contacter</Link>
        </div>
      </div>
    </div>
  );
}
