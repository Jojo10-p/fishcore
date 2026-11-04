// Envoi d'e-mails transactionnels via Resend (https://resend.com), sans dépendance.
//   RESEND_API_KEY : clé d'API (réglages Vercel, jamais dans le code)
//   EMAIL_FROM     : adresse d'expédition d'un domaine vérifié chez Resend (ex. alertes@mondomaine.com)

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail(params: { to: string[]; subject: string; html: string; text: string; fromName?: string }): Promise<void> {
  const to = [...new Set(params.to.filter(Boolean))];
  if (!to.length) throw new Error("Aucun destinataire");
  const from = params.fromName ? `${params.fromName.replace(/[<>"]/g, "")} <${process.env.EMAIL_FROM}>` : process.env.EMAIL_FROM!;
  const res = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: params.subject, html: params.html, text: params.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Envoi refusé (${res.status}) ${body.slice(0, 200)}`);
  }
}
