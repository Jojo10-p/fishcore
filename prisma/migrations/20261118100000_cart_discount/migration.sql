-- Réduction accordée sur le total du panier
ALTER TABLE "sales"
  ADD COLUMN "cartDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discountReason" TEXT,
  ADD COLUMN "discountStatus" TEXT,
  ADD COLUMN "discountValidatedById" TEXT,
  ADD COLUMN "discountValidatedAt" TIMESTAMP(3);
CREATE INDEX "sales_companyId_discountStatus_idx" ON "sales"("companyId", "discountStatus");
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SALE_DISCOUNT_VALIDATED';
