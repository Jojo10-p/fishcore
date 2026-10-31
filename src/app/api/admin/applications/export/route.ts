import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { buildApplicationOrder, buildApplicationWhere } from "@/server/services/admin-applications";
import { audit } from "@/server/audit";
import { APPLICATION_STATUS_META } from "@/lib/status";
import { toNumber } from "@/lib/utils";

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise les injections de formules dans les tableurs
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.type !== "STAFF" || !user.can("applications.export")) return new NextResponse("Forbidden", { status: 403 });
  const f = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await db.loanApplication.findMany({ where: buildApplicationWhere(f), orderBy: buildApplicationOrder(f.tri), include: { customer: true, product: true }, take: 10000 });
  const head = ["Référence", "Date de dépôt", "Statut", "Nom", "Prénoms", "Email", "Téléphone", "Ville", "Pays", "Offre", "Montant", "Durée (mois)", "Objet", "Revenus mensuels", "Charges mensuelles", "Démo"];
  const lines = rows.map((a) => [a.reference, a.createdAt.toISOString(), APPLICATION_STATUS_META[a.status].label, a.customer.lastName, a.customer.firstName, a.customer.email, a.customer.phone, a.customer.city, a.customer.country, a.product.name, toNumber(a.amount), a.durationMonths, a.purpose, toNumber(a.customer.monthlyIncome), toNumber(a.customer.monthlyCharges), a.isDemo ? "oui" : "non"].map(csv).join(";"));
  await audit({ actorId: user.id, action: "application.exported_list", entity: "LoanApplication", metadata: { count: rows.length, filters: f } });
  return new NextResponse("﻿" + [head.map(csv).join(";"), ...lines].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="demandes-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
