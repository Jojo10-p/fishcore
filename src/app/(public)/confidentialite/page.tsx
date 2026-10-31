import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Politique de confidentialité" };

export default async function Page() {
  const s = await getSettings();
  return <LegalPage title="Politique de confidentialité" content={s.compliance.privacyPolicy} fallback="Ce document doit être rédigé et validé juridiquement, puis renseigné dans Administration › Paramètres › Informations légales." />;
}
