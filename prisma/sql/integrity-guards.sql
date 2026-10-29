-- ═══════════════════════════════════════════════════════════════════
-- fishcore — Garde-fous d'intégrité au niveau PostgreSQL
-- ═══════════════════════════════════════════════════════════════════
-- Ces règles complètent le code applicatif : même un bug ou un accès
-- direct à la base ne peut pas les contourner.
--
-- Application (première migration) :
--   1. npx prisma migrate dev --name init --create-only
--   2. Copier le contenu de ce fichier À LA FIN de
--      prisma/migrations/<horodatage>_init/migration.sql
--   3. npx prisma migrate dev
-- ═══════════════════════════════════════════════════════════════════

-- 1. Journal d'audit en ajout seul (cahier §17.3)
--    Aucune modification ni suppression, quel que soit l'utilisateur SQL.
CREATE OR REPLACE FUNCTION fishcore_audit_logs_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est en ajout seul : % interdit', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON "audit_logs";
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION fishcore_audit_logs_immutable();

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON "audit_logs";
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION fishcore_audit_logs_immutable();

-- 2. Une seule session ouverte par caisse, et par caissier (cahier §7.3)
CREATE UNIQUE INDEX IF NOT EXISTS "cash_sessions_one_open_per_register"
  ON "cash_sessions" ("cashRegisterId") WHERE "closedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cash_sessions_one_open_per_cashier"
  ON "cash_sessions" ("cashierId") WHERE "closedAt" IS NULL;

-- 3. Le stock ne peut jamais être négatif, ni inférieur aux réserves offline
ALTER TABLE "stocks" DROP CONSTRAINT IF EXISTS "stocks_quantity_non_negative";
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_quantity_non_negative"
  CHECK ("quantity" >= 0 AND "reservedQty" >= 0 AND "reservedQty" <= "quantity");

-- 4. Une demande d'annulation en attente au plus par vente (cahier §10)
CREATE UNIQUE INDEX IF NOT EXISTS "cancellations_one_pending_per_sale"
  ON "cancellations" ("saleId") WHERE "status" = 'PENDING';

-- 5. Réserves hors ligne : jamais négatives (cahier §9.4)
ALTER TABLE "stock_reservations" DROP CONSTRAINT IF EXISTS "stock_reservations_quantity_non_negative";
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_quantity_non_negative"
  CHECK ("quantity" >= 0);

-- 6. Finances : montants positifs, une facture fournisseur jamais « surpayée »
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_paid_within_total";
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_paid_within_total"
  CHECK ("paidAmount" >= 0 AND "paidAmount" <= "totalAmount");
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_amount_positive";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "supplier_payments" DROP CONSTRAINT IF EXISTS "supplier_payments_amount_positive";
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_positive" CHECK ("amount" > 0);

-- Retraits : jamais plus que la quantité vendue
ALTER TABLE "sale_lines" DROP CONSTRAINT IF EXISTS "sale_lines_delivered_within_sold";
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_delivered_within_sold"
  CHECK ("deliveredQuantity" >= 0 AND "deliveredQuantity" <= "quantity");
ALTER TABLE "delivery_lines" DROP CONSTRAINT IF EXISTS "delivery_lines_quantity_positive";
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_quantity_positive" CHECK ("quantity" > 0);
-- Plus aucune vente à crédit
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_no_credit";
ALTER TABLE "payments" ADD CONSTRAINT "payments_no_credit" CHECK ("method" <> 'CREDIT') NOT VALID;
