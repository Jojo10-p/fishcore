-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "amountTendered" DECIMAL(12,2),
ADD COLUMN     "changeGiven" DECIMAL(12,2),
ADD COLUMN     "customerName" TEXT;

-- CreateTable
CREATE TABLE "product_suggestions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "liters" DECIMAL(8,3),
    "unitsPerCarton" INTEGER,
    "category" TEXT,

    CONSTRAINT "product_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_suggestions_name_key" ON "product_suggestions"("name");
