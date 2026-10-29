import { config } from "dotenv";

// Même ordre que Next.js : .env.local prioritaire, puis .env
config({ path: ".env.local" });
config();
import { defineConfig, env } from "prisma/config";

// Prisma 7 : configuration de la CLI (migrate, studio, introspection).
// Les migrations passent par la connexion DIRECTE (port 5432), pas par
// le pooler pgbouncer (port 6543) qui ne supporte pas les DDL transactionnels.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DIRECT_URL") },
});
