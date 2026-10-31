import type { Metadata } from "next";
import { Mail, Phone, MapPin, Clock } from "lucide-react";
import { PageHero } from "@/components/site/page-hero";
import { ContactForm } from "@/components/forms/contact-form";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage() {
  const [{ t }, { org }] = await Promise.all([getI18n(), getSettings()]);
  const items = [
    { icon: Mail, label: t("contact.email"), value: org.email, href: org.email ? `mailto:${org.email}` : undefined },
    { icon: Phone, label: t("contact.phone"), value: org.phone, href: org.phone ? `tel:${org.phone.replace(/\s/g, "")}` : undefined },
    { icon: MapPin, label: t("contact.address"), value: org.address },
    { icon: Clock, label: t("contact.hours"), value: org.hours },
  ].filter((i) => i.value);
  return (
    <>
      <PageHero label={t("nav.contact")} title={t("contact.title")} text={t("contact.subtitle")} />
      <div className="container grid gap-10 lg:grid-cols-12">
        <div className="rounded-[28px] border border-night/[.07] bg-white p-6 sm:p-10 lg:col-span-8">
          <ContactForm labels={{ name: t("contact.form.name"), email: t("contact.form.email"), phone: t("contact.form.phone"), subject: t("contact.form.subject"), message: t("contact.form.message"), submit: t("contact.form.submit"), success: t("contact.form.success") }} />
        </div>
        <aside className="space-y-6 lg:col-span-4">
          {items.map((i) => (
            <div key={i.label} className="flex gap-4 border-b border-night/10 pb-6">
              <i.icon className="mt-1 h-5 w-5 shrink-0 text-teal" strokeWidth={1.7} />
              <div>
                <p className="text-sm text-ink-faint">{i.label}</p>
                {i.href ? <a href={i.href} className="mt-0.5 block font-semibold hover:text-teal-700">{i.value}</a> : <p className="mt-0.5 whitespace-pre-line font-semibold">{i.value}</p>}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
