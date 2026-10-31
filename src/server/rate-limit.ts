import "server-only";
import { db, tbl } from "@/lib/db";

/**
 * Limiteur à fenêtre fixe persistant en base (fonctionne sur plusieurs instances).
 * Retourne true si la requête est autorisée.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO ${tbl("rate_limits")} AS "rate_limits" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limits"."resetAt" < ${now} THEN 1 ELSE "rate_limits"."count" + 1 END,
      "resetAt" = CASE WHEN "rate_limits"."resetAt" < ${now} THEN ${resetAt} ELSE "rate_limits"."resetAt" END
    RETURNING "count"`;
  return (rows[0]?.count ?? 1) <= limit;
}
