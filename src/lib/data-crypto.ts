import crypto from "crypto";

// ─────────────────────────────────────────────
// Chiffrement des secrets confiés par les entreprises (jeton e-MCF de la DGI…)
// ─────────────────────────────────────────────
// AES-256-GCM, clé tirée de DATA_ENCRYPTION_KEY (dédiée : changer JWT_SECRET ne
// rend pas les secrets illisibles). Format stocké : v1.<iv>.<tag>.<données> (base64url).

const MIN = 32;

function key(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw || raw.length < MIN) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[CONFIG] DATA_ENCRYPTION_KEY absente ou trop courte (min. 32 caractères) : openssl rand -base64 32");
    }
    return crypto.createHash("sha256").update(`dev-only-data-key:${process.env.JWT_SECRET ?? ""}`).digest();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Secret chiffré illisible");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Affichage sûr : seuls les 4 derniers caractères. */
export function maskSecret(plain: string): string {
  return plain.length <= 8 ? "••••" : `••••${plain.slice(-4)}`;
}
