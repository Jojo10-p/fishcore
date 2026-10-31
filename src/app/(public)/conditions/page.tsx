import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conditions générales" };

export default async function Page() {
  const s = await getSettings();
  return <LegalPage title="Conditions générales" content={s.compliance.terms} fallback="Ce document doit être rédigé et validé juridiquement, puis renseigné dans Administration › Paramètres › Informations légales." />;
}
