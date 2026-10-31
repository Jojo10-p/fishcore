import { ShieldCheck, ShieldAlert } from "lucide-react";
import { requireStaff } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { PageHeader } from "@/components/client/app-shell";
import { Card } from "@/components/client/shared";
import { SettingsSection } from "@/components/admin/settings-section";

export const metadata = { title: "Paramètres" };
const LOCALE_OPTS = [{ value: "fr", label: "Français" }, { value: "en", label: "English" }];

export default async function AdminSettings() {
  const me = await requireStaff("settings.manage");
  const s = await getSettings();
  const isSuper = me.roleKey === "super_admin";
  const nav = [["structure", "Structure"], ["conformite", "Conformité"], ["langues", "Langues & devise"], ["simulateur", "Simulateur"], ["securite", "Sécurité"], ["seo", "SEO"], ["equipe", "Équipe"]];
  return (
    <>
      <PageHeader title="Paramètres généraux" />
      <nav className="mb-6 flex gap-2 overflow-x-auto pb-1" aria-label="Sections">{nav.map(([id, l]) => <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm text-ink-soft hover:text-ink">{l}</a>)}</nav>
      <div className="space-y-6">
        <section id="structure" className="scroll-mt-24"><Card title="Structure et coordonnées">
          <SettingsSection section="org" initial={s.org} fields={[
            { path: "name", label: "Nom commercial" }, { path: "legalName", label: "Raison sociale" },
            { path: "tagline", label: "Signature" }, { path: "email", label: "Email de contact" },
            { path: "phone", label: "Téléphone" }, { path: "hours", label: "Horaires" },
            { path: "address", label: "Adresse", type: "textarea", rows: 2 },
            { path: "logoUrl", label: "Logo (adresse de l'image)", hint: "Téléversez l'image dans Contenus du site, puis collez son adresse. Vide = monogramme par défaut.", full: true },
            { path: "social.linkedin", label: "LinkedIn (URL)" }, { path: "social.facebook", label: "Facebook (URL)" },
            { path: "social.instagram", label: "Instagram (URL)" }, { path: "social.x", label: "X (URL)" },
          ]} />
        </Card></section>

        <section id="conformite" className="scroll-mt-24">
          <Card title="Conformité et informations légales">
            <div className={`mb-6 flex gap-3 rounded-xl p-4 text-sm ${s.compliance.licensed ? "bg-teal-50 text-teal-700" : "bg-champagne-50 text-champagne-700"}`}>
              {s.compliance.licensed ? <ShieldCheck className="h-5 w-5 shrink-0" /> : <ShieldAlert className="h-5 w-5 shrink-0" />}
              <p>{s.compliance.licensed
                ? `Activité déclarée autorisée (${s.compliance.regulator}, n° ${s.compliance.licenseNumber}). Les décisions d'approbation et de refus sont activées.`
                : "Mode pré-agrément : un bandeau informe les visiteurs qu'aucune offre de crédit n'est émise, et les décisions d'approbation ou de refus sont désactivées dans le back-office. N'activez l'agrément qu'une fois les autorisations obtenues et les procédures validées."}</p>
            </div>
            {!isSuper && <p className="mb-4 text-sm text-ink-faint">Section modifiable uniquement par un super administrateur.</p>}
            <SettingsSection section="compliance" initial={s.compliance} disabled={!isSuper} fields={[
              { path: "licensed", label: "L'établissement dispose des autorisations requises pour exercer l'activité de crédit", type: "checkbox", hint: "Active les décisions dans le back-office et retire le bandeau public." },
              { path: "regulator", label: "Autorité de tutelle" }, { path: "licenseNumber", label: "Numéro d'agrément" },
              { path: "registrationNumber", label: "Immatriculation (RCS, RCCM, SIREN…)", full: true },
              { path: "legalNotice", label: "Mentions légales", type: "textarea", rows: 8, hint: "Paragraphes séparés par une ligne vide ; « ## » en début de ligne pour un intertitre." },
              { path: "privacyPolicy", label: "Politique de confidentialité", type: "textarea", rows: 8 },
              { path: "terms", label: "Conditions générales", type: "textarea", rows: 8 },
            ]} />
          </Card>
        </section>

        <section id="langues" className="scroll-mt-24"><Card title="Langues et devise">
          <SettingsSection section="locale" initial={s.locale} fields={[
            { path: "enabled", label: "Langues proposées sur le site", type: "multi", options: LOCALE_OPTS },
            { path: "default", label: "Langue par défaut", type: "select", options: LOCALE_OPTS },
            { path: "currency", label: "Devise (code ISO)", hint: "Ex. : EUR, XOF, USD, CAD" },
            { path: "numberLocale", label: "Format des nombres", hint: "Ex. : fr-FR, fr-BJ, en-US" },
          ]} />
        </Card></section>

        <section id="simulateur" className="scroll-mt-24"><Card title="Simulateur et indicateurs publics">
          <SettingsSection section="simulator" initial={s.simulator} fields={[{ path: "defaultAmount", label: "Montant proposé par défaut", type: "number" }, { path: "defaultDuration", label: "Durée proposée par défaut (mois)", type: "number" }]} />
          <div className="mt-8 border-t border-night/[.06] pt-6">
            <SettingsSection section="publicStats" initial={s.publicStats} fields={[
              { path: "enabled", label: "Afficher des indicateurs sur la page d'accueil", type: "checkbox", hint: "Calculés en temps réel sur les dossiers réels (hors démonstration). Masqués tant que le seuil n'est pas atteint." },
              { path: "minApplications", label: "Seuil minimal de dossiers étudiés", type: "number" },
            ]} />
          </div>
        </Card></section>

        <section id="securite" className="scroll-mt-24"><Card title="Sécurité">
          <SettingsSection section="security" initial={s.security} fields={[
            { path: "maxLoginAttempts", label: "Tentatives avant verrouillage", type: "number" },
            { path: "lockMinutes", label: "Durée du verrouillage (minutes)", type: "number" },
            { path: "sessionDays", label: "Durée de session client (jours)", type: "number", hint: "Les sessions du back-office expirent après 24 h maximum." },
          ]} />
        </Card></section>

        <section id="seo" className="scroll-mt-24"><Card title="Référencement (SEO)">
          <SettingsSection section="seo" initial={s.seo} fields={[{ path: "title", label: "Titre par défaut", full: true }, { path: "description", label: "Description", type: "textarea", rows: 2 }, { path: "ogImage", label: "Image de partage (adresse)", full: true }]} />
        </Card></section>

        <section id="equipe" className="scroll-mt-24"><Card title="Équipe (page À propos)">
          <SettingsSection section="about" initial={s.about} fields={[{ path: "team", label: "Membres affichés", type: "team" }]} />
        </Card></section>
      </div>
    </>
  );
}
