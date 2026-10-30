-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_PROGRESS', 'VALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'PASSWORD_RESET_LINK_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'USER_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'USER_REACTIVATED';
ALTER TYPE "AuditEventType" ADD VALUE 'INVENTORY_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'STOCK_TRANSFER_RECEIVED';
ALTER TYPE "AuditEventType" ADD VALUE 'STOCK_TRANSFER_CANCELLED';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "inventoryCounter" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "transferCounter" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "inventories" DROP COLUMN "isValidated",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "companyId" TEXT NOT NULL,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "number" TEXT NOT NULL,
ADD COLUMN     "status" "InventoryStatus" NOT NULL DEFAULT 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "inventory_lines" ADD COLUMN     "countedAt" TIMESTAMP(3),
ADD COLUMN     "countedById" TEXT,
ADD COLUMN     "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
ALTER COLUMN "countedQty" DROP NOT NULL,
ALTER COLUMN "discrepancy" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stock_transfers" DROP COLUMN "isValidated",
DROP COLUMN "validatedAt",
DROP COLUMN "validatedById",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "companyId" TEXT NOT NULL,
ADD COLUMN     "number" TEXT NOT NULL,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" TEXT,
ADD COLUMN     "receptionNotes" TEXT,
ADD COLUMN     "status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT';

-- AlterTable
ALTER TABLE "stock_transfer_lines" ADD COLUMN     "batches" JSONB,
ADD COLUMN     "receivedQty" DECIMAL(12,3),
ADD COLUMN     "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "company_brand_assets" (
    "companyId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "logo512" BYTEA NOT NULL,
    "logo192" BYTEA NOT NULL,
    "maskable512" BYTEA NOT NULL,

    CONSTRAINT "company_brand_assets_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "inventories_centerId_status_idx" ON "inventories"("centerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventories_companyId_number_key" ON "inventories"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lines_inventoryId_productId_key" ON "inventory_lines"("inventoryId", "productId");

-- CreateIndex
CREATE INDEX "stock_transfers_fromCenterId_status_idx" ON "stock_transfers"("fromCenterId", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_toCenterId_status_idx" ON "stock_transfers"("toCenterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_companyId_number_key" ON "stock_transfers"("companyId", "number");

-- AddForeignKey
ALTER TABLE "company_brand_assets" ADD CONSTRAINT "company_brand_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_toCenterId_fkey" FOREIGN KEY ("toCenterId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
