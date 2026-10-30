-- CreateEnum
CREATE TYPE "EmecfDocType" AS ENUM ('FV', 'FA');

-- CreateEnum
CREATE TYPE "EmecfStatus" AS ENUM ('PENDING', 'SUBMITTED', 'NORMALIZED', 'FAILED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "emecfAib" TEXT,
ADD COLUMN     "emecfDefaultTaxGroup" TEXT NOT NULL DEFAULT 'B',
ADD COLUMN     "emecfEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emecfMode" TEXT NOT NULL DEFAULT 'test',
ADD COLUMN     "emecfNim" TEXT,
ADD COLUMN     "emecfTokenEnc" TEXT,
ADD COLUMN     "emecfTokenValidUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "emecfTaxGroup" TEXT;

-- CreateTable
CREATE TABLE "emecf_documents" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "type" "EmecfDocType" NOT NULL,
    "status" "EmecfStatus" NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL,
    "uid" TEXT,
    "total" INTEGER,
    "totals" JSONB,
    "codeMecefDgi" TEXT,
    "qrCode" TEXT,
    "counters" TEXT,
    "nim" TEXT,
    "dgiDateTime" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "normalizedAt" TIMESTAMP(3),

    CONSTRAINT "emecf_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emecf_documents_companyId_status_idx" ON "emecf_documents"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "emecf_documents_saleId_type_key" ON "emecf_documents"("saleId", "type");

-- AddForeignKey
ALTER TABLE "emecf_documents" ADD CONSTRAINT "emecf_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emecf_documents" ADD CONSTRAINT "emecf_documents_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
