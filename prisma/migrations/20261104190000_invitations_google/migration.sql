-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'INVITATION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'INVITATION_ACCEPTED';
ALTER TYPE "AuditEventType" ADD VALUE 'INVITATION_REVOKED';
ALTER TYPE "AuditEventType" ADD VALUE 'GOOGLE_LOGIN';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "googleSub" TEXT;

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT,
    "role" "UserRole" NOT NULL,
    "label" TEXT,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_usedById_key" ON "invitations"("usedById");

-- CreateIndex
CREATE INDEX "invitations_companyId_usedAt_idx" ON "invitations"("companyId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
