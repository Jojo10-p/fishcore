import { config } from "dotenv";

// Même ordre que Next.js : .env.local prioritaire, puis .env
config({ path: ".env.local" });
config();
import { defineConfig } from "prisma/config";

// Prisma 7 : configuration de la CLI (migrate, studio, introspection).
// Les migrations passent par la connexion DIRECTE (port 5432), pas par
// le pooler pgbouncer (port 6543) qui ne supporte pas les DDL transactionnels.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Sans DIRECT_URL (premier « npm install », avant de remplir .env.local) :
  // adresse factice, suffisante pour générer le client. Les migrations, elles,
  // échoueront clairement tant que DIRECT_URL n'est pas renseignée.
  datasource: { url: process.env.DIRECT_URL || "postgresql://direct-url-a-configurer@localhost:5432/fishcore" },
});
