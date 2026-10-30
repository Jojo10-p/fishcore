-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_SUSPENDED';
ALTER TYPE "AuditEventType" ADD VALUE 'COMPANY_REACTIVATED';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "platformNotes" TEXT;

-- CreateTable
CREATE TABLE "account_deletions" (
    "id" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "businessType" TEXT NOT NULL,
    "companyCreatedAt" TIMESTAMP(3) NOT NULL,
    "reasons" TEXT[],
    "otherReason" TEXT,
    "centersCount" INTEGER NOT NULL DEFAULT 0,
    "usersCount" INTEGER NOT NULL DEFAULT 0,
    "productsCount" INTEGER NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "salesTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lastSaleAt" TIMESTAMP(3),

    CONSTRAINT "account_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_deletions_deletedAt_idx" ON "account_deletions"("deletedAt");
