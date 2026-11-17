-- Facture normalisée e-MECeF (DGI Bénin)
ALTER TABLE "companies"
  ADD COLUMN "mecefEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mecefMode" TEXT NOT NULL DEFAULT 'TEST',
  ADD COLUMN "mecefTokenEnc" TEXT,
  ADD COLUMN "mecefTaxGroup" TEXT NOT NULL DEFAULT 'B',
  ADD COLUMN "mecefNim" TEXT,
  ADD COLUMN "mecefTokenValid" TIMESTAMP(3),
  ADD COLUMN "mecefCheckedAt" TIMESTAMP(3);

ALTER TABLE "products" ADD COLUMN "mecefTaxGroup" TEXT;

CREATE TABLE "mecef_invoices" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cancellationId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lockedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "uid" TEXT,
    "codeMecef" TEXT,
    "qrCode" TEXT,
    "counters" TEXT,
    "nim" TEXT,
    "dgiDateTime" TEXT,
    "totals" JSONB,
    CONSTRAINT "mecef_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mecef_invoices_saleId_kind_key" ON "mecef_invoices"("saleId", "kind");
CREATE INDEX "mecef_invoices_companyId_status_idx" ON "mecef_invoices"("companyId", "status");
ALTER TABLE "mecef_invoices" ADD CONSTRAINT "mecef_invoices_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Comme les autres tables : accès uniquement par le serveur
ALTER TABLE "mecef_invoices" ENABLE ROW LEVEL SECURITY;
