-- Arrivages validés avant la case « déjà payé / pris à crédit » : ils étaient
-- comptés comme dette chez le fournisseur. Ils ont été payés : on les passe en payé.
-- (Données seulement ; rejouable sans effet : ne touche que paymentMode IS NULL.)

-- 1. Règlement « payé à l'arrivage » du reste dû, pour les factures dont tous les arrivages sont anciens
INSERT INTO "supplier_payments" ("id", "createdAt", "companyId", "supplierId", "purchaseId", "amount", "method", "allocations", "paidById", "notes", "atReceipt")
SELECT
  'mig' || substr(md5(p."id" || random()::text), 1, 22),
  COALESCE((SELECT MIN(g."validatedAt") FROM "goods_receipts" g WHERE g."purchaseId" = p."id"), p."createdAt"),
  p."companyId",
  p."supplierId",
  p."id",
  p."totalAmount" - p."paidAmount",
  'CASH',
  jsonb_build_array(jsonb_build_object('purchaseId', p."id", 'amount', (p."totalAmount" - p."paidAmount")::text)),
  p."createdById",
  'Arrivage antérieur marqué payé',
  true
FROM "purchases" p
WHERE p."totalAmount" > p."paidAmount"
  AND EXISTS (SELECT 1 FROM "goods_receipts" g WHERE g."purchaseId" = p."id" AND g."isValidated" AND g."paymentMode" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "goods_receipts" g WHERE g."purchaseId" = p."id" AND g."paymentMode" IS NOT NULL);

UPDATE "purchases" p SET "paidAmount" = p."totalAmount", "lastReminderAt" = NULL
WHERE p."totalAmount" > p."paidAmount"
  AND EXISTS (SELECT 1 FROM "goods_receipts" g WHERE g."purchaseId" = p."id" AND g."isValidated" AND g."paymentMode" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "goods_receipts" g WHERE g."purchaseId" = p."id" AND g."paymentMode" IS NOT NULL);

-- 2. Les arrivages eux-mêmes : « déjà payé, en espèces »
UPDATE "goods_receipts" SET "paymentMode" = 'PAID', "paymentMethod" = 'CASH'
WHERE "isValidated" AND "paymentMode" IS NULL;
