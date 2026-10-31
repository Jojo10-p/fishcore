import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mentions légales" };

export default async function Page() {
  const s = await getSettings();
  return <LegalPage title="Mentions légales" content={s.compliance.legalNotice} fallback="Ce document doit être rédigé et validé juridiquement, puis renseigné dans Administration › Paramètres › Informations légales." />;
}
