import nodemailer from "nodemailer";

// ─────────────────────────────────────────────
// Envoi d'e-mails (SMTP : Gmail avec mot de passe d'application, Brevo…)
// ─────────────────────────────────────────────
// Variables : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM (facultatif).
// En test (MAIL_TRANSPORT=memory) les messages sont gardés en mémoire.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const outbox: Mail[] = [];

export function mailConfigured(): boolean {
  return process.env.MAIL_TRANSPORT === "memory" || !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail(mail: Mail): Promise<void> {
  if (process.env.MAIL_TRANSPORT === "memory") {
    outbox.push(mail);
    return;
  }
  if (!mailConfigured()) throw new Error("Envoi d'e-mails non configuré (SMTP_HOST / SMTP_USER / SMTP_PASS)");
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = process.env.MAIL_FROM || process.env.SMTP_USER!;
  await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}
