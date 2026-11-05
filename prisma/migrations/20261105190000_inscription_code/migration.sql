-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'ACCOUNT_SIGNUP';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "joinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "joinLockedUntil" TIMESTAMP(3);
