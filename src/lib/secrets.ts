// ─────────────────────────────────────────────
// Secrets techniques — lus UNE fois, jamais de valeur par défaut en production
// ─────────────────────────────────────────────
// Module volontairement sans dépendance (pas de Prisma) : il est importé
// par le proxy (src/proxy.ts) qui doit rester léger.

const MIN_SECRET_LENGTH = 32;

function readSecret(name: string, devFallback: string): Uint8Array {
  const value = process.env[name];

  if (!value || value.length < MIN_SECRET_LENGTH) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `[CONFIG] La variable ${name} est absente ou trop courte (min. ${MIN_SECRET_LENGTH} caractères). ` +
          `Générez-la avec : openssl rand -base64 32`
      );
    }
    if (!value) {
      console.warn(`[CONFIG] ${name} non défini — secret de développement utilisé. NE PAS DÉPLOYER ainsi.`);
    }
    return new TextEncoder().encode(value || devFallback);
  }

  return new TextEncoder().encode(value);
}

let jwtSecret: Uint8Array | null = null;
let installSecret: Uint8Array | null = null;

/** Clé de signature des jetons de session (cookie fishcore-session). */
export function getJwtSecret(): Uint8Array {
  jwtSecret ??= readSecret("JWT_SECRET", "dev-only-jwt-secret-not-for-production-use");
  return jwtSecret;
}

/** Clé de signature des liens d'installation des agences. */
export function getInstallLinkSecret(): Uint8Array {
  installSecret ??= readSecret("INSTALL_LINK_SECRET", "dev-only-install-secret-not-for-production");
  return installSecret;
}

export const SESSION_COOKIE = "fishcore-session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
