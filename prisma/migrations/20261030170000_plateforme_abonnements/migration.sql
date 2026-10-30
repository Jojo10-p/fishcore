-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'SUBSCRIPTION_PAYMENT_RECORDED';
ALTER TYPE "AuditEventType" ADD VALUE 'SUBSCRIPTION_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_SUSPENDED';
ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_REACTIVATED';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "customMaxCenters" INTEGER,
ADD COLUMN     "customMaxUsers" INTEGER,
ADD COLUMN     "paidUntil" TIMESTAMP(3),
ADD COLUMN     "planCode" TEXT NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "platformNotes" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "plans" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPrice" INTEGER NOT NULL DEFAULT 0,
    "maxCenters" INTEGER,
    "maxUsers" INTEGER,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_payments_companyId_createdAt_idx" ON "subscription_payments"("companyId", "createdAt");

-- Offres par défaut (prix modifiables dans l'espace plateforme)
INSERT INTO "plans" ("code", "name", "monthlyPrice", "maxCenters", "maxUsers", "description", "isActive", "sortOrder") VALUES
  ('TRIAL', 'Essai gratuit', 0, NULL, NULL, 'Toutes les fonctions pendant 14 jours', false, 0),
  ('ESSENTIEL', 'Essentiel', 10000, 1, 3, 'Une boutique, jusqu''à 3 utilisateurs', true, 1),
  ('PRO', 'Pro', 25000, 3, 10, 'Jusqu''à 3 magasins ou dépôts, 10 utilisateurs', true, 2),
  ('ENTREPRISE', 'Entreprise', 50000, NULL, NULL, 'Magasins et utilisateurs illimités', true, 3)
ON CONFLICT ("code") DO NOTHING;

-- Entreprises déjà inscrites : 14 jours d'essai à partir de maintenant
UPDATE "companies" SET "trialEndsAt" = NOW() + INTERVAL '14 days' WHERE "trialEndsAt" IS NULL;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
