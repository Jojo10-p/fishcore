import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/server/settings";

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderTemplate(tpl: string, vars: Record<string, string>, html: boolean) {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k] ?? "";
    return html ? escapeHtml(v) : v;
  });
}

function layout(orgName: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#F7F8FA;font-family:Inter,Segoe UI,Arial,sans-serif;color:#101C35">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #E9EDF2">
<tr><td style="padding:24px 32px;background:#101C35;border-radius:16px 16px 0 0;color:#fff;font-weight:700;font-size:18px">${escapeHtml(orgName)}<span style="color:#C9A96E">.</span></td></tr>
<tr><td style="padding:32px;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px 28px;font-size:12px;color:#8592A8">Ceci est un message automatique. Nous ne vous demanderons jamais de paiement ni vos identifiants par email.</td></tr>
</table></td></tr></table></body></html>`;
}

async function deliver(to: string, subject: string, html: string, text: string) {
  const e = env();
  if (e.MAIL_PROVIDER === "resend") {
    if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY manquant");
    const { Resend } = await import("resend");
    const r = await new Resend(e.RESEND_API_KEY).emails.send({ from: e.MAIL_FROM, to, subject, html, text });
    if (r.error) throw new Error(r.error.message);
    return;
  }
  if (e.MAIL_PROVIDER === "smtp") {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT ?? 587,
      secure: e.SMTP_SECURE === "true",
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    });
    await t.sendMail({ from: e.MAIL_FROM, to, subject, html, text });
    return;
  }
  console.info(`\n[mail:console] → ${to}\nSujet : ${subject}\n${text}\n`);
}

/**
 * Envoie un email à partir d'un modèle stocké en base (éditable dans le back-office)
 * et journalise l'envoi dans l'historique des notifications.
 */
export async function sendTemplatedEmail(params: { to: string; templateKey: string; vars: Record<string, string>; userId?: string | null; locale?: string }) {
  const settings = await getSettings();
  const vars = { orgName: settings.org.name, appUrl: env().APP_URL, ...params.vars };
  const tpl =
    (await db.emailTemplate.findUnique({ where: { key_locale: { key: params.templateKey, locale: params.locale ?? "fr" } } })) ??
    (await db.emailTemplate.findFirst({ where: { key: params.templateKey } }));
  const subject = tpl ? renderTemplate(tpl.subject, vars, false) : `${settings.org.name} — notification`;
  const bodyText = tpl ? renderTemplate(tpl.body, vars, false) : Object.values(params.vars).join("\n");
  const bodyHtml = (tpl ? renderTemplate(tpl.body, vars, true) : escapeHtml(bodyText))
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  let status: "SENT" | "FAILED" = "SENT";
  let error: string | null = null;
  try {
    await deliver(params.to, subject, layout(settings.org.name, bodyHtml), bodyText);
  } catch (e) {
    status = "FAILED";
    error = e instanceof Error ? e.message : String(e);
    console.error("[mail] échec", error);
  }
  await db.notification.create({
    data: { channel: "EMAIL", status, userId: params.userId ?? null, recipientEmail: params.to, templateKey: params.templateKey, title: subject, body: bodyText.slice(0, 2000), error },
  });
  return status === "SENT";
}
