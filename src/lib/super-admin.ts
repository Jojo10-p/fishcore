import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getJwtSecret } from "@/lib/secrets";

// ─────────────────────────────────────────────
// Super administrateur unique : connexion par code reçu par e-mail
// ─────────────────────────────────────────────
// L'adresse est fixée par SUPER_ADMIN_EMAIL. Elle seule se connecte sans
// mot de passe et reçoit le rôle de propriétaire (COMPANY_OWNER) de
// l'entreprise ; personne ne peut lui retirer ce rôle ni créer un autre
// propriétaire.

export const CODE_LENGTH = 8;
export const CODE_TTL_MIN = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_SECONDS = 60;
export const CODE_MAX_PER_HOUR = 6;
// Sans caractères ambigus (0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function superAdminEmail(): string | null {
  const v = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  return v || null;
}

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  const admin = superAdminEmail();
  return !!admin && !!email && email.trim().toLowerCase() === admin;
}

export function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** Saisie tolérante : espaces, tirets et minuscules ignorés. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function hashCode(email: string, code: string): string {
  return crypto.createHmac("sha256", getJwtSecret()).update(`${email.toLowerCase()}:${normalizeCode(code)}`).digest("hex");
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Entreprise du super admin : SUPER_ADMIN_COMPANY_ID, sinon la plus ancienne entreprise active. */
export async function superAdminCompanyId(): Promise<string | null> {
  const id = process.env.SUPER_ADMIN_COMPANY_ID?.trim();
  if (id) return id;
  const c = await prisma.company.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return c?.id ?? null;
}

export const formatCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

export function codeMail(code: string, appName: string) {
  const pretty = formatCode(code);
  return {
    subject: `${pretty} — votre code de connexion ${appName}`,
    text: `Votre code de connexion : ${pretty}\n\nIl est valable ${CODE_TTL_MIN} minutes et ne sert qu'une fois.\nSi vous n'avez pas demandé ce code, ignorez ce message.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#111">
<p style="font-size:15px">Votre code de connexion à <b>${appName}</b> :</p>
<p style="font-size:34px;font-weight:bold;letter-spacing:6px;text-align:center;background:#F3F4F6;border-radius:12px;padding:18px 0;margin:18px 0">${pretty}</p>
<p style="font-size:13px;color:#555">Valable ${CODE_TTL_MIN} minutes, une seule fois. Si vous n'avez pas demandé ce code, ignorez ce message.</p>
</div>`,
  };
}
