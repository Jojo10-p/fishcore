-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "threshold" DECIMAL(12,3) NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "emailError" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_alerts_companyId_resolvedAt_idx" ON "stock_alerts"("companyId", "resolvedAt");

-- CreateIndex
CREATE INDEX "stock_alerts_centerId_productId_idx" ON "stock_alerts"("centerId", "productId");

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
