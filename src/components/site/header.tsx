"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, UserRound } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setLocaleAction } from "@/server/actions/locale";

interface Props {
  orgName: string;
  logoUrl?: string;
  locale: string;
  locales: string[];
  isLogged: boolean;
  labels: { solutions: string; simulator: string; about: string; faq: string; contact: string; apply: string; login: string; account: string };
}

export function SiteHeader({ orgName, logoUrl, locale, locales, isLogged, labels }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [pending, start] = useTransition();
  const links = [
    { href: "/solutions", label: labels.solutions },
    { href: "/simulateur", label: labels.simulator },
    { href: "/a-propos", label: labels.about },
    { href: "/faq", label: labels.faq },
    { href: "/contact", label: labels.contact },
  ];
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  const LangSwitch = ({ className }: { className?: string }) => (
    <div className={cn("flex items-center rounded-full border border-night/10 p-0.5 text-xs font-semibold", className)} role="group" aria-label="Langue">
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          aria-pressed={l === locale}
          onClick={() => start(() => setLocaleAction(l))}
          className={cn("rounded-full px-2.5 py-1 uppercase transition", l === locale ? "bg-night text-white" : "text-ink-soft hover:text-ink")}
        >
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <header className={cn("sticky top-0 z-40 transition-[background,box-shadow] duration-300", scrolled || open ? "bg-paper/90 shadow-[0_1px_0_rgba(16,28,53,.08)] backdrop-blur-md" : "bg-transparent")}>
      <div className="container flex h-[72px] items-center justify-between gap-6">
        <Link href="/" aria-label={`${orgName} — accueil`}>
          <Logo name={orgName} logoUrl={logoUrl} />
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn("rounded-full px-3.5 py-2 text-[15px] transition", pathname.startsWith(l.href) ? "text-night font-semibold" : "text-ink-soft hover:text-ink")}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <LangSwitch />
          <Link href={isLogged ? "/espace" : "/connexion"} className="inline-flex items-center gap-1.5 text-[15px] text-ink-soft hover:text-ink">
            <UserRound className="h-4 w-4" /> {isLogged ? labels.account : labels.login}
          </Link>
          <Link href="/demande" className={buttonVariants({ size: "md" })}>{labels.apply}</Link>
        </div>
        <button type="button" className="-mr-2 rounded-full p-2 lg:hidden" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-nav"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-x-0 top-[72px] bottom-0 overflow-y-auto bg-paper lg:hidden"
          >
            <nav className="container flex flex-col py-6" aria-label="Navigation mobile">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="border-b border-night/[.07] py-4 font-display text-2xl font-semibold">
                  {l.label}
                </Link>
              ))}
              <Link href={isLogged ? "/espace" : "/connexion"} className="py-4 text-lg text-ink-soft">{isLogged ? labels.account : labels.login}</Link>
              <div className="mt-4 flex flex-col gap-4">
                <Link href="/demande" className={buttonVariants({ size: "lg", className: "w-full" })}>{labels.apply}</Link>
                <LangSwitch className="self-start" />
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
