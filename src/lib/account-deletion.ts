import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Suppression définitive d'un compte entreprise
// ─────────────────────────────────────────────
// Tout disparaît, dans une seule transaction (tout ou rien) : centres, caisses,
// articles, stocks, ventes, factures, devis, clients, fournisseurs, dépenses,
// utilisateurs, sessions, logo, journal d'audit. L'adresse e-mail est aussitôt
// libre pour une nouvelle inscription.

const C = `$1`;
const CENTERS = `SELECT "id" FROM "centers" WHERE "companyId" = ${C}`;
const SALES = `SELECT "id" FROM "sales" WHERE "companyId" = ${C}`;
const REGISTERS = `SELECT "id" FROM "cash_registers" WHERE "centerId" IN (${CENTERS})`;
const SESSIONS = `SELECT "id" FROM "cash_sessions" WHERE "cashRegisterId" IN (${REGISTERS})`;
const PRODUCTS = `SELECT "id" FROM "products" WHERE "companyId" = ${C}`;
const STOCKS = `SELECT "id" FROM "stocks" WHERE "centerId" IN (${CENTERS}) OR "productId" IN (${PRODUCTS})`;
const USERS = `SELECT "id" FROM "users" WHERE "companyId" = ${C}`;

/** Ordre : des données les plus dépendantes vers l'entreprise elle-même. */
const STATEMENTS: Array<[string, string]> = [
  ["journal d'audit", `DELETE FROM "audit_logs" WHERE "companyId" = ${C}`],
  ["notifications", `DELETE FROM "notifications" WHERE "companyId" = ${C}`],
  ["synchronisations", `DELETE FROM "sync_operations" WHERE "companyId" = ${C}`],
  ["liens d'installation", `DELETE FROM "agency_install_links" WHERE "companyId" = ${C}`],
  ["numéros de facture", `DELETE FROM "invoice_number_blocks" WHERE "companyId" = ${C}`],
  ["logo", `DELETE FROM "company_brand_assets" WHERE "companyId" = ${C}`],
  ["documents", `DELETE FROM "documents" WHERE "companyId" = ${C} OR "saleId" IN (${SALES})`],
  ["retraits", `DELETE FROM "delivery_lines" WHERE "deliveryId" IN (SELECT "id" FROM "deliveries" WHERE "companyId" = ${C} OR "saleId" IN (${SALES}))`],
  ["retraits", `DELETE FROM "deliveries" WHERE "companyId" = ${C} OR "saleId" IN (${SALES})`],
  ["annulations", `DELETE FROM "cancellations" WHERE "saleId" IN (${SALES})`],
  ["remboursements", `DELETE FROM "refunds" WHERE "saleId" IN (${SALES}) OR "sessionId" IN (${SESSIONS})`],
  ["paiements", `DELETE FROM "payments" WHERE "saleId" IN (${SALES})`],
  ["devis", `DELETE FROM "quote_lines" WHERE "quoteId" IN (SELECT "id" FROM "quotes" WHERE "companyId" = ${C})`],
  ["devis", `DELETE FROM "quotes" WHERE "companyId" = ${C}`],
  ["lignes de vente", `DELETE FROM "sale_lines" WHERE "saleId" IN (${SALES})`],
  ["ventes", `DELETE FROM "sales" WHERE "companyId" = ${C}`],
  ["réserves de caisse", `DELETE FROM "stock_reservations" WHERE "stockId" IN (${STOCKS}) OR "sessionId" IN (${SESSIONS})`],
  ["mouvements de stock", `DELETE FROM "stock_movements" WHERE "stockId" IN (${STOCKS}) OR "centerId" IN (${CENTERS})`],
  ["inventaires", `DELETE FROM "inventory_lines" WHERE "inventoryId" IN (SELECT "id" FROM "inventories" WHERE "companyId" = ${C})`],
  ["inventaires", `DELETE FROM "inventories" WHERE "companyId" = ${C}`],
  ["transferts", `DELETE FROM "stock_transfer_lines" WHERE "transferId" IN (SELECT "id" FROM "stock_transfers" WHERE "companyId" = ${C})`],
  ["transferts", `DELETE FROM "stock_transfers" WHERE "companyId" = ${C}`],
  ["lots", `DELETE FROM "batches" WHERE "productId" IN (${PRODUCTS}) OR "centerId" IN (${CENTERS})`],
  ["réceptions", `DELETE FROM "goods_receipt_lines" WHERE "receiptId" IN (SELECT "id" FROM "goods_receipts" WHERE "centerId" IN (${CENTERS}))`],
  ["réceptions", `DELETE FROM "goods_receipts" WHERE "centerId" IN (${CENTERS})`],
  ["règlements fournisseurs", `DELETE FROM "supplier_payments" WHERE "companyId" = ${C}`],
  ["achats", `DELETE FROM "purchases" WHERE "companyId" = ${C}`],
  ["fournisseurs", `DELETE FROM "suppliers" WHERE "companyId" = ${C}`],
  ["dépenses", `DELETE FROM "expenses" WHERE "companyId" = ${C}`],
  ["mouvements de caisse", `DELETE FROM "cash_movements" WHERE "sessionId" IN (${SESSIONS})`],
  ["clôtures", `DELETE FROM "cash_closures" WHERE "sessionId" IN (${SESSIONS})`],
  ["sessions de caisse", `DELETE FROM "cash_sessions" WHERE "id" IN (${SESSIONS})`],
  ["caisses", `DELETE FROM "cash_registers" WHERE "id" IN (${REGISTERS})`],
  ["stocks", `DELETE FROM "stocks" WHERE "id" IN (${STOCKS})`],
  ["historique des prix", `DELETE FROM "product_price_history" WHERE "productId" IN (${PRODUCTS})`],
  ["conversions d'unités", `DELETE FROM "unit_conversions" WHERE "productId" IN (${PRODUCTS})`],
  ["articles", `DELETE FROM "products" WHERE "companyId" = ${C}`],
  ["familles", `DELETE FROM "categories" WHERE "companyId" = ${C}`],
  ["unités", `DELETE FROM "units" WHERE "companyId" = ${C}`],
  ["clients", `DELETE FROM "customers" WHERE "companyId" = ${C}`],
  ["mots de passe", `DELETE FROM "password_reset_tokens" WHERE "userId" IN (${USERS})`],
  ["sessions de connexion", `DELETE FROM "auth_sessions" WHERE "userId" IN (${USERS})`],
  ["affectations", `DELETE FROM "user_centers" WHERE "userId" IN (${USERS}) OR "centerId" IN (${CENTERS})`],
  ["utilisateurs", `DELETE FROM "users" WHERE "companyId" = ${C}`],
  ["centres", `DELETE FROM "centers" WHERE "companyId" = ${C}`],
  ["entreprise", `DELETE FROM "companies" WHERE "id" = ${C}`],
];

export interface DeletionFeedback {
  reasons: string[];
  otherReason?: string | null;
}

/**
 * Supprime l'entreprise et toutes ses données. Avant l'effacement, la raison du
 * départ et un résumé de l'activité sont gardés pour le créateur de la
 * plateforme (registre account_deletions). Renvoie les lignes supprimées par table.
 */
export async function purgeCompany(companyId: string, feedback: DeletionFeedback = { reasons: [] }): Promise<Record<string, number>> {
  return prisma.$transaction(
    async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { tradeName: true, ownerName: true, email: true, phone: true, city: true, businessType: true, createdAt: true },
      });
      if (!company) throw new Error("Entreprise introuvable");
      const [centersCount, usersCount, productsCount, sales] = await Promise.all([
        tx.center.count({ where: { companyId } }),
        tx.user.count({ where: { companyId } }),
        tx.product.count({ where: { companyId } }),
        tx.sale.aggregate({ where: { companyId, status: { not: "CANCELLED" } }, _count: true, _sum: { totalAmount: true }, _max: { createdAt: true } }),
      ]);
      await tx.accountDeletion.create({
        data: {
          companyId,
          tradeName: company.tradeName,
          ownerName: company.ownerName,
          email: company.email,
          phone: company.phone,
          city: company.city,
          businessType: company.businessType,
          companyCreatedAt: company.createdAt,
          reasons: feedback.reasons,
          otherReason: feedback.otherReason || null,
          centersCount,
          usersCount,
          productsCount,
          salesCount: sales._count,
          salesTotal: sales._sum.totalAmount ?? 0,
          lastSaleAt: sales._max.createdAt,
        },
      });
      // Autorise, pour CETTE transaction et CETTE entreprise seulement, la
      // suppression de son journal d'audit (voir prisma/sql/integrity-guards.sql)
      await tx.$executeRaw`SELECT set_config('fishcore.purge_company', ${companyId}, true)`;
      const counts: Record<string, number> = {};
      for (const [label, sql] of STATEMENTS) {
        const n = await tx.$executeRawUnsafe(sql, companyId);
        counts[label] = (counts[label] ?? 0) + n;
      }
      if (!counts["entreprise"]) throw new Error("Entreprise introuvable");
      return counts;
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}
