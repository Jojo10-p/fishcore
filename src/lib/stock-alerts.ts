import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emailConfigured, sendEmail } from "@/lib/email";
import { APP_NAME } from "@/lib/app-config";

// ─────────────────────────────────────────────
// Alertes de stock bas
// ─────────────────────────────────────────────
// Un article dont le stock d'un centre descend à son seuil (« seuil d'alerte »
// de la fiche article) ouvre UNE alerte pour ce centre. Elle reste ouverte tant
// que le stock est bas (sa quantité suit les ventes) et se ferme d'elle-même
// quand le stock remonte au-dessus du seuil (réception, transfert, inventaire…).
// Chaque nouvelle alerte est signalée au propriétaire : cloche dans le
// logiciel et e-mail (si l'envoi d'e-mails est configuré).

const D = Prisma.Decimal;

export interface NewStockAlert {
  id: string;
  productName: string;
  reference: string | null;
  unit: string;
  centerName: string;
  quantity: Prisma.Decimal;
  threshold: Prisma.Decimal;
}

/** Compare tout le stock de l'entreprise aux seuils : ouvre, met à jour et ferme les alertes. */
export async function syncStockAlerts(companyId: string): Promise<NewStockAlert[]> {
  const low = await prisma.$queryRaw<Array<{ centerId: string; productId: string; quantity: Prisma.Decimal; threshold: Prisma.Decimal }>>`
    SELECT s."centerId", s."productId", s."quantity", p."stockAlertQty" AS threshold
      FROM "stocks" s
      JOIN "products" p ON p."id" = s."productId"
      JOIN "centers" c ON c."id" = s."centerId"
     WHERE p."companyId" = ${companyId}
       AND p."isActive" = true
       AND p."stockAlertQty" > 0
       AND s."quantity" <= p."stockAlertQty"`;
  const open = await prisma.stockAlert.findMany({
    where: { companyId, resolvedAt: null },
    select: { id: true, centerId: true, productId: true, quantity: true },
  });
  const key = (c: string, p: string) => `${c}:${p}`;
  const lowMap = new Map(low.map((l) => [key(l.centerId, l.productId), l]));
  const openMap = new Map(open.map((o) => [key(o.centerId, o.productId), o]));

  const createdIds: string[] = [];
  for (const [k, l] of lowMap) {
    const existing = openMap.get(k);
    if (existing) {
      if (!new D(existing.quantity).equals(l.quantity)) {
        await prisma.stockAlert.update({ where: { id: existing.id }, data: { quantity: l.quantity } });
      }
      continue;
    }
    // L'index partiel « une alerte ouverte par centre et article » évite les doublons
    // si deux ventes simultanées font passer le seuil en même temps.
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "stock_alerts" ("id", "companyId", "centerId", "productId", "quantity", "threshold", "createdAt", "updatedAt")
      VALUES (${"sa_" + crypto.randomUUID().replace(/-/g, "")}, ${companyId}, ${l.centerId}, ${l.productId}, ${l.quantity}, ${l.threshold}, NOW(), NOW())
      ON CONFLICT ("centerId", "productId") WHERE "resolvedAt" IS NULL DO NOTHING
      RETURNING "id"`;
    if (rows[0]) createdIds.push(rows[0].id);
  }
  const resolved = open.filter((o) => !lowMap.has(key(o.centerId, o.productId))).map((o) => o.id);
  if (resolved.length) {
    await prisma.stockAlert.updateMany({ where: { id: { in: resolved }, resolvedAt: null }, data: { resolvedAt: new Date() } });
  }
  if (!createdIds.length) return [];
  const created = await prisma.stockAlert.findMany({
    where: { id: { in: createdIds } },
    select: {
      id: true,
      quantity: true,
      threshold: true,
      center: { select: { name: true } },
      product: { select: { name: true, internalCode: true, baseUnit: { select: { symbol: true } } } },
    },
    orderBy: { quantity: "asc" },
  });
  return created.map((a) => ({
    id: a.id,
    productName: a.product.name,
    reference: a.product.internalCode,
    unit: a.product.baseUnit.symbol,
    centerName: a.center.name,
    quantity: a.quantity,
    threshold: a.threshold,
  }));
}

const qty = (d: Prisma.Decimal) => Number(d).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** E-mail envoyé au propriétaire : liste des articles passés sous leur seuil. */
export function lowStockEmail(params: { appName: string; tradeName: string; alerts: NewStockAlert[]; link: string; logoUrl?: string | null }) {
  const { appName, tradeName, alerts, link, logoUrl } = params;
  const n = alerts.length;
  const subject = n === 1 ? `Stock bas : ${alerts[0].productName} (${alerts[0].centerName})` : `Stock bas : ${n} articles à recommander`;
  const rows = alerts
    .map(
      (a) => `<tr>
        <td style="padding:12px 14px;border-bottom:1px solid #eef1f6">
          <div style="font-weight:600;color:#0b1f4b">${esc(a.productName)}</div>
          <div style="font-size:12px;color:#6b7280">${a.reference ? `Réf. ${esc(a.reference)} · ` : ""}${esc(a.centerName)}</div>
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #eef1f6;text-align:right;white-space:nowrap">
          <span style="display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;font-size:13px;${Number(a.quantity) <= 0 ? "background:#fee2e2;color:#b91c1c" : "background:#fef3c7;color:#92400e"}">${qty(a.quantity)} ${esc(a.unit)}</span>
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #eef1f6;text-align:right;color:#6b7280;white-space:nowrap">${qty(a.threshold)} ${esc(a.unit)}</td>
      </tr>`
    )
    .join("");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5fa;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5fa;padding:28px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(11,31,75,.08)">
    <tr><td style="background:#0b1f4b;padding:22px 26px">
      <table role="presentation" width="100%"><tr>
        ${logoUrl ? `<td width="56"><img src="${esc(logoUrl)}" width="48" height="48" alt="" style="border-radius:10px;background:#fff;display:block"></td>` : ""}
        <td style="color:#ffffff"><div style="font-size:18px;font-weight:700">${esc(appName)}</div><div style="font-size:13px;color:#f5c451">${esc(tradeName)}</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:26px 26px 6px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#e3a82b;text-transform:uppercase">Alerte de stock</div>
      <h1 style="margin:6px 0 8px;font-size:22px;color:#0b1f4b">${n === 1 ? "Un article arrive en rupture" : `${n} articles arrivent en rupture`}</h1>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.55">${n === 1 ? "Cet article est descendu" : "Ces articles sont descendus"} à leur seuil d'alerte. Pensez à recommander avant la rupture.</p>
    </td></tr>
    <tr><td style="padding:14px 26px 4px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #eef1f6;border-radius:10px;border-collapse:separate;font-size:14px">
        <tr style="background:#f8fafc"><th align="left" style="padding:10px 14px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Article · boutique</th><th align="right" style="padding:10px 14px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Reste</th><th align="right" style="padding:10px 14px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Seuil</th></tr>
        ${rows}
      </table>
    </td></tr>
    <tr><td style="padding:22px 26px 28px" align="left">
      <a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;font-size:14px">Voir les alertes de stock</a>
      <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">L'alerte disparaît d'elle-même quand la marchandise est réceptionnée. Message automatique de ${esc(appName)} (${APP_NAME}).</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
  const text = [
    `${appName} — ${tradeName}`,
    "",
    n === 1 ? "Un article arrive en rupture :" : `${n} articles arrivent en rupture :`,
    ...alerts.map((a) => `- ${a.productName} (${a.centerName}) : reste ${qty(a.quantity)} ${a.unit}, seuil ${qty(a.threshold)} ${a.unit}`),
    "",
    `Voir les alertes : ${link}`,
  ].join("\n");
  return { subject, html, text };
}

/** Prévient le(s) propriétaire(s) par e-mail des nouvelles alertes. */
export async function emailNewAlerts(companyId: string, alerts: NewStockAlert[]): Promise<void> {
  if (!alerts.length) return;
  const ids = alerts.map((a) => a.id);
  if (!emailConfigured()) {
    await prisma.stockAlert.updateMany({ where: { id: { in: ids } }, data: { emailError: "Envoi d'e-mails non configuré" } });
    return;
  }
  const [company, owners] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tradeName: true, appName: true, logoUrl: true } }),
    prisma.user.findMany({ where: { companyId, role: "COMPANY_OWNER", isActive: true }, select: { email: true } }),
  ]);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const appName = company.appName || company.tradeName;
  const mail = lowStockEmail({
    appName,
    tradeName: company.tradeName,
    alerts,
    link: `${origin}/alertes`,
    logoUrl: company.logoUrl && origin ? `${origin}/api/brand/${companyId}/icon-192.png` : null,
  });
  try {
    await sendEmail({ to: owners.map((o) => o.email), fromName: appName, ...mail });
    await prisma.stockAlert.updateMany({ where: { id: { in: ids } }, data: { emailedAt: new Date(), emailError: null } });
  } catch (e) {
    await prisma.stockAlert.updateMany({ where: { id: { in: ids } }, data: { emailError: String((e as Error).message ?? e).slice(0, 300) } });
  }
}

const pending = new Set<Promise<void>>();

/**
 * À appeler après toute opération qui change le stock : la vérification tourne
 * après l'envoi de la réponse (la caisse n'attend pas l'e-mail).
 */
export function scheduleStockAlerts(companyId: string | null | undefined): void {
  if (!companyId) return;
  const job = async () => {
    try {
      const created = await syncStockAlerts(companyId);
      await emailNewAlerts(companyId, created);
    } catch (e) {
      console.error("[stock-alerts]", e);
    }
  };
  try {
    after(job);
  } catch {
    // Hors requête (tests, scripts) : exécution directe, attendable avec waitForStockAlerts()
    const p = job().finally(() => pending.delete(p));
    pending.add(p);
  }
}

/** Tests : attend la fin des vérifications lancées hors requête. */
export async function waitForStockAlerts(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
