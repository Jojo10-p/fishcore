-- Super administrateur unique, créé avec le code d'installation
ALTER TABLE "users" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "users_one_super_admin" ON "users"("isSuperAdmin") WHERE "isSuperAdmin";

-- Essais du code d'installation
CREATE TABLE "setup_attempts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,

    CONSTRAINT "setup_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "setup_attempts_createdAt_idx" ON "setup_attempts"("createdAt");

-- Table interne : accessible seulement au serveur
ALTER TABLE "setup_attempts" ENABLE ROW LEVEL SECURITY;
