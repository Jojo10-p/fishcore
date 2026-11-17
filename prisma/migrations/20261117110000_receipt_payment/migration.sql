-- Arrivage déjà payé ou pris à crédit (rappels à la direction)
ALTER TABLE "goods_receipts" ADD COLUMN "paymentMode" TEXT, ADD COLUMN "paymentMethod" "PaymentMethod";
ALTER TABLE "purchases" ADD COLUMN "lastReminderAt" TIMESTAMP(3);
ALTER TABLE "supplier_payments" ADD COLUMN "atReceipt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "dueRemindersAt" TIMESTAMP(3);
