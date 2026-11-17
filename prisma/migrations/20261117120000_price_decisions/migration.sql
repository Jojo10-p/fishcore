-- Baisse du prix d'achat : décision de la direction, ancien stock à l'ancien prix
ALTER TABLE "products"
  ADD COLUMN "pendingPrice" DECIMAL(12,2),
  ADD COLUMN "pendingPackagings" JSONB,
  ADD COLUMN "pendingPriceLeft" DECIMAL(12,3);

CREATE TABLE "price_decisions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "oldCost" DECIMAL(14,4) NOT NULL,
    "newCost" DECIMAL(14,4) NOT NULL,
    "currentPrice" DECIMAL(12,2) NOT NULL,
    "proposedPrice" DECIMAL(12,2),
    "proposedPackagings" JSONB,
    "oldQty" DECIMAL(12,3) NOT NULL,
    "proposedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "chosenPrice" DECIMAL(12,2),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    CONSTRAINT "price_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "price_decisions_companyId_status_idx" ON "price_decisions"("companyId", "status");
ALTER TABLE "price_decisions" ENABLE ROW LEVEL SECURITY;
