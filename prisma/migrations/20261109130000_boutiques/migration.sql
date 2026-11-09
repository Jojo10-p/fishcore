-- Deux boutiques (huile de moteur / huile d'arachide) : articles et suggestions propres à chaque boutique
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "centerId" TEXT;

-- AlterTable
ALTER TABLE "product_suggestions" ADD COLUMN     "centerId" TEXT;

-- CreateIndex
CREATE INDEX "products_centerId_idx" ON "products"("centerId");

-- CreateIndex
CREATE INDEX "product_suggestions_centerId_idx" ON "product_suggestions"("centerId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
