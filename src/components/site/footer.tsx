import Link from "next/link";
import { Mail, Phone, MapPin } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import type { Settings } from "@/server/settings";
import type { DictKey } from "@/lib/i18n/dictionaries";

export function SiteFooter({ settings, t }: { settings: Settings; t: (k: DictKey) => string }) {
  const { org, compliance } = settings;
  const socials = [
    { href: org.social.linkedin, short: "in", label: "LinkedIn" },
    { href: org.social.facebook, short: "f", label: "Facebook" },
    { href: org.social.instagram, short: "ig", label: "Instagram" },
    { href: org.social.x, short: "X", label: "X" },
  ].filter((s) => s.href);
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-24 overflow-hidden bg-night text-white">
      <div className="grain absolute inset-0 opacity-60" aria-hidden />
      <div className="container relative grid gap-12 py-16 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo name={org.name} invert logoUrl={org.logoUrl || undefined} />
          <p className="mt-5 max-w-xs text-[15px] leading-relaxed text-white/60">{t("footer.tagline")}</p>
          {socials.length > 0 && (
            <div className="mt-6 flex gap-2">
              {socials.map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} className="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-white/70 transition hover:border-champagne hover:text-champagne">
                  <span className="text-xs font-bold">{s.short}</span>
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="md:col-span-2">
          <p className="mb-4 text-sm font-semibold text-champagne">{t("footer.navigation")}</p>
          <ul className="space-y-2.5 text-[15px] text-white/70">
            <li><Link className="hover:text-white" href="/solutions">{t("nav.solutions")}</Link></li>
            <li><Link className="hover:text-white" href="/simulateur">{t("nav.simulator")}</Link></li>
            <li><Link className="hover:text-white" href="/demande">{t("nav.apply")}</Link></li>
            <li><Link className="hover:text-white" href="/a-propos">{t("nav.about")}</Link></li>
            <li><Link className="hover:text-white" href="/faq">{t("nav.faq")}</Link></li>
          </ul>
        </div>
        <div className="md:col-span-3">
          <p className="mb-4 text-sm font-semibold text-champagne">{t("footer.contact")}</p>
          <ul className="space-y-3 text-[15px] text-white/70">
            {org.email && <li className="flex gap-2.5"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-white/40" /><a href={`mailto:${org.email}`} className="hover:text-white">{org.email}</a></li>}
            {org.phone && <li className="flex gap-2.5"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-white/40" /><a href={`tel:${org.phone.replace(/\s/g, "")}`} className="hover:text-white">{org.phone}</a></li>}
            {org.address && <li className="flex gap-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-white/40" /><span>{org.address}</span></li>}
          </ul>
        </div>
        <div className="md:col-span-3">
          <p className="mb-4 text-sm font-semibold text-champagne">{t("footer.legal")}</p>
          <ul className="space-y-2.5 text-[15px] text-white/70">
            <li><Link className="hover:text-white" href="/mentions-legales">{t("footer.legalNotice")}</Link></li>
            <li><Link className="hover:text-white" href="/confidentialite">{t("footer.privacy")}</Link></li>
            <li><Link className="hover:text-white" href="/conditions">{t("footer.terms")}</Link></li>
          </ul>
        </div>
      </div>
      <div className="container relative border-t border-white/10 py-6 text-[13px] leading-relaxed text-white/45">
        <p className="mb-2 text-white/60">{t("footer.warning")}</p>
        <p>
          © {year} {org.legalName || org.name}. {t("footer.rights")}
          {compliance.licensed && compliance.licenseNumber && <> · {compliance.regulator} n° {compliance.licenseNumber}</>}
          {compliance.registrationNumber && <> · {compliance.registrationNumber}</>}
        </p>
      </div>
    </footer>
  );
}
