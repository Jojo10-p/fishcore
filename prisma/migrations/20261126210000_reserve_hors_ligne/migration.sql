-- Réserve de numéros de facture par appareil : ouvrir sa caisse sans Internet
ALTER TABLE "invoice_number_blocks" ADD COLUMN IF NOT EXISTS "standbyUserId" TEXT;
ALTER TABLE "invoice_number_blocks" ADD COLUMN IF NOT EXISTS "standbyDeviceId" TEXT;
CREATE INDEX IF NOT EXISTS "invoice_number_blocks_standbyUserId_standbyDeviceId_idx" ON "invoice_number_blocks"("standbyUserId", "standbyDeviceId");
