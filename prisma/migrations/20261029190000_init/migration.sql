-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'COMPANY_OWNER', 'CENTER_MANAGER', 'CASHIER', 'ACCOUNTANT', 'STOCK_MANAGER', 'SALES_EMPLOYEE');

-- CreateEnum
CREATE TYPE "CenterStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CashRegisterState" AS ENUM ('ACTIVE', 'INACTIVE', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('GENERAL', 'FISHMONGER', 'HARDWARE', 'BUILDING_MATERIALS', 'OIL_DISTRIBUTION', 'SUPERMARKET', 'PHARMACY', 'WHOLESALE');

-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('COUNT', 'WEIGHT', 'VOLUME', 'LENGTH', 'AREA', 'PACKAGING');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEPTION', 'SALE', 'CUSTOMER_RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'LOSS', 'DETERIORATION', 'INVENTORY_ADJUST', 'CORRECTION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'CARD', 'TRANSFER', 'MIXED', 'CREDIT');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PARTIAL', 'DELIVERED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED');

-- CreateEnum
CREATE TYPE "CancellationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('QUOTE', 'PURCHASE_ORDER', 'DELIVERY_NOTE', 'RECEIPT_NOTE', 'INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'REFUND_RECEIPT');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGED', 'CASH_SESSION_OPENED', 'CASH_SESSION_CLOSED', 'CASH_CLOSURE_VALIDATED', 'CASH_MOVEMENT_RECORDED', 'SALE_CREATED', 'SALE_CANCELLED', 'SALE_REFUNDED', 'CANCELLATION_REQUESTED', 'CANCELLATION_APPROVED', 'CANCELLATION_REJECTED', 'STOCK_RECEIVED', 'STOCK_ADJUSTED', 'STOCK_TRANSFERRED', 'STOCK_LOSS_RECORDED', 'STOCK_RESERVED', 'STOCK_RESERVATION_RELEASED', 'INVENTORY_STARTED', 'INVENTORY_VALIDATED', 'USER_CREATED', 'USER_DEACTIVATED', 'ROLE_CHANGED', 'PERMISSION_CHANGED', 'PRICE_CHANGED', 'DOCUMENT_EXPORTED', 'QUOTE_CREATED', 'QUOTE_CANCELLED', 'GOODS_DELIVERED', 'EXPENSE_RECORDED', 'EXPENSE_CANCELLED', 'CUSTOMER_PAYMENT_RECEIVED', 'SUPPLIER_PAYMENT_MADE', 'PURCHASE_RECORDED', 'COMPANY_SETTINGS_CHANGED', 'CENTER_CREATED', 'INSTALL_LINK_GENERATED', 'INSTALL_LINK_USED', 'SYNC_COMPLETED', 'SYNC_FAILED', 'UNAUTHORIZED_ACCESS_ATTEMPT', 'BACKUP_CREATED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tradeName" TEXT NOT NULL,
    "legalName" TEXT,
    "logoUrl" TEXT,
    "ownerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "commune" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BJ',
    "poBox" TEXT,
    "taxId" TEXT,
    "tradeRegNumber" TEXT,
    "fiscalInfo" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Porto-Novo',
    "businessType" "BusinessType" NOT NULL DEFAULT 'GENERAL',
    "vatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'FACT',
    "invoiceCounter" INTEGER NOT NULL DEFAULT 1,
    "quotePrefix" TEXT NOT NULL DEFAULT 'DEV',
    "quoteCounter" INTEGER NOT NULL DEFAULT 1,
    "quoteValidityDays" INTEGER NOT NULL DEFAULT 15,
    "invoiceNotes" TEXT,
    "invoiceFormat" TEXT NOT NULL DEFAULT 'TICKET_80',
    "requiresPickup" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "managerId" TEXT,
    "status" "CenterStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_install_links" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "agency_install_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "loginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_centers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalCode" TEXT,
    "barcode" TEXT,
    "brand" TEXT,
    "categoryId" TEXT,
    "description" TEXT,
    "attributes" JSONB,
    "trackBatches" BOOLEAN NOT NULL DEFAULT false,
    "requiresExpiry" BOOLEAN NOT NULL DEFAULT false,
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT false,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "baseUnitId" TEXT NOT NULL,
    "purchasePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sellingPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stockAlertQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isBaseUnit" BOOLEAN NOT NULL DEFAULT false,
    "kind" "UnitKind" NOT NULL DEFAULT 'COUNT',
    "allowsDecimal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_conversions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromUnitId" TEXT NOT NULL,
    "toUnitId" TEXT NOT NULL,
    "factor" DECIMAL(12,6) NOT NULL,
    "sellingPrice" DECIMAL(12,2),
    "barcode" TEXT,

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_history" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT NOT NULL,
    "purchasePrice" DECIMAL(12,2) NOT NULL,
    "sellingPrice" DECIMAL(12,2) NOT NULL,
    "changedById" TEXT NOT NULL,

    CONSTRAINT "product_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "centerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stockId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitId" TEXT,
    "batchId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "performedById" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptId" TEXT,
    "productId" TEXT,
    "centerId" TEXT,
    "initialQty" DECIMAL(12,3),
    "remainingQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,4),
    "lotNumber" TEXT,
    "packageCount" INTEGER,
    "grossWeight" DECIMAL(12,3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "sessionId" TEXT,
    "cashMovementId" TEXT,
    "allocations" JSONB,
    "paidById" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_number_blocks" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "first" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,
    "sessionId" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "invoice_number_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
    "validUntil" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "saleId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "deliveredById" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_lines" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "centerId" TEXT NOT NULL,
    "supplierId" TEXT,
    "purchaseId" TEXT,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isValidated" BOOLEAN NOT NULL DEFAULT false,
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "transportCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "iceCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "handlingCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherCosts" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "draftData" JSONB,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packageCount" INTEGER,
    "grossWeight" DECIMAL(12,3),
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitId" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "landedUnitCost" DECIMAL(14,4),
    "lotNumber" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "taxId" TEXT,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "centerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "CashRegisterState" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingBalance" DECIMAL(12,2) NOT NULL,
    "closingBalance" DECIMAL(12,2),
    "theoreticalBalance" DECIMAL(12,2),
    "discrepancy" DECIMAL(12,2),
    "isValidated" BOOLEAN NOT NULL DEFAULT false,
    "validatedById" TEXT,
    "notes" TEXT,
    "deviceId" TEXT,
    "connectionState" TEXT,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT,
    "performedById" TEXT NOT NULL,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closures" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "openingBalance" DECIMAL(12,2) NOT NULL,
    "totalSales" DECIMAL(12,2) NOT NULL,
    "totalCash" DECIMAL(12,2) NOT NULL,
    "totalMobileMoney" DECIMAL(12,2) NOT NULL,
    "totalCard" DECIMAL(12,2) NOT NULL,
    "totalOther" DECIMAL(12,2) NOT NULL,
    "totalRefunds" DECIMAL(12,2) NOT NULL,
    "totalCashOut" DECIMAL(12,2) NOT NULL,
    "theoreticalBalance" DECIMAL(12,2) NOT NULL,
    "declaredBalance" DECIMAL(12,2) NOT NULL,
    "discrepancy" DECIMAL(12,2) NOT NULL,
    "cashierId" TEXT NOT NULL,
    "validatedById" TEXT,
    "notes" TEXT,

    CONSTRAINT "cash_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "customerId" TEXT,
    "saleNumber" TEXT NOT NULL,
    "invoiceSeq" INTEGER,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'DELIVERED',
    "createdOffline" BOOLEAN NOT NULL DEFAULT false,
    "deviceId" TEXT,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitId" TEXT,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "baseQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deliveredQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "saleId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "CancellationStatus" NOT NULL DEFAULT 'PENDING',
    "requestReason" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "stockImpact" JSONB,
    "cashImpact" DECIMAL(12,2),

    CONSTRAINT "cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saleId" TEXT NOT NULL,
    "sessionId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "centerId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "validatedById" TEXT,
    "isValidated" BOOLEAN NOT NULL DEFAULT false,
    "validatedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lines" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "theoreticalQty" DECIMAL(12,3) NOT NULL,
    "countedQty" DECIMAL(12,3) NOT NULL,
    "discrepancy" DECIMAL(12,3) NOT NULL,
    "discrepancyReason" TEXT,

    CONSTRAINT "inventory_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fromCenterId" TEXT NOT NULL,
    "toCenterId" TEXT NOT NULL,
    "isValidated" BOOLEAN NOT NULL DEFAULT false,
    "validatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "validatedById" TEXT,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitId" TEXT,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "payee" TEXT,
    "sessionId" TEXT,
    "cashMovementId" TEXT,
    "createdById" TEXT NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT,
    "saleId" TEXT,
    "type" "DocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "data" JSONB NOT NULL,
    "isVoided" BOOLEAN NOT NULL DEFAULT false,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "centerId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "centerId" TEXT,
    "deviceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "dependsOn" TEXT,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,
    "centerId" TEXT,
    "userId" TEXT,
    "eventType" "AuditEventType" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "deviceTimestamp" TIMESTAMP(3),
    "serverTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT,
    "reason" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "metadata" JSONB,
    "previousHash" TEXT,
    "hash" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_email_key" ON "companies"("email");

-- CreateIndex
CREATE UNIQUE INDEX "centers_companyId_code_key" ON "centers"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "agency_install_links_token_key" ON "agency_install_links"("token");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_centers_userId_centerId_key" ON "user_centers"("userId", "centerId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_sessionToken_key" ON "auth_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "products_companyId_name_idx" ON "products"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_companyId_barcode_key" ON "products"("companyId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "categories_companyId_name_key" ON "categories"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "units_companyId_symbol_key" ON "units"("companyId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "unit_conversions_productId_fromUnitId_key" ON "unit_conversions"("productId", "fromUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "stocks_centerId_productId_key" ON "stocks"("centerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_sessionId_stockId_key" ON "stock_reservations"("sessionId", "stockId");

-- CreateIndex
CREATE INDEX "batches_productId_centerId_expiresAt_idx" ON "batches"("productId", "centerId", "expiresAt");

-- CreateIndex
CREATE INDEX "purchases_companyId_supplierId_idx" ON "purchases"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_cashMovementId_key" ON "supplier_payments"("cashMovementId");

-- CreateIndex
CREATE INDEX "supplier_payments_companyId_supplierId_idx" ON "supplier_payments"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "invoice_number_blocks_companyId_sessionId_idx" ON "invoice_number_blocks"("companyId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_saleId_key" ON "quotes"("saleId");

-- CreateIndex
CREATE INDEX "quotes_companyId_createdAt_idx" ON "quotes"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_companyId_number_key" ON "quotes"("companyId", "number");

-- CreateIndex
CREATE INDEX "deliveries_companyId_createdAt_idx" ON "deliveries"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_saleId_number_key" ON "deliveries"("saleId", "number");

-- CreateIndex
CREATE INDEX "customers_companyId_name_idx" ON "customers"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closures_sessionId_key" ON "cash_closures"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_idempotencyKey_key" ON "sales"("idempotencyKey");

-- CreateIndex
CREATE INDEX "sales_companyId_centerId_createdAt_idx" ON "sales"("companyId", "centerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sales_companyId_saleNumber_key" ON "sales"("companyId", "saleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_companyId_invoiceSeq_key" ON "sales"("companyId", "invoiceSeq");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_cashMovementId_key" ON "expenses"("cashMovementId");

-- CreateIndex
CREATE INDEX "expenses_companyId_date_idx" ON "expenses"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "documents_number_key" ON "documents"("number");

-- CreateIndex
CREATE UNIQUE INDEX "sync_operations_idempotencyKey_key" ON "sync_operations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_serverTimestamp_idx" ON "audit_logs"("companyId", "serverTimestamp");

-- AddForeignKey
ALTER TABLE "centers" ADD CONSTRAINT "centers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_install_links" ADD CONSTRAINT "agency_install_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_install_links" ADD CONSTRAINT "agency_install_links_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_centers" ADD CONSTRAINT "user_centers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_centers" ADD CONSTRAINT "user_centers_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_fromUnitId_fkey" FOREIGN KEY ("fromUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_toUnitId_fkey" FOREIGN KEY ("toUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_fromCenterId_fkey" FOREIGN KEY ("fromCenterId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- Garde-fous SQL (rejoués à chaque déploiement par scripts/apply-sql-guards.mjs)
-- ─────────────────────────────────────────────
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

-- Plages de numéros de facture : bornes cohérentes
ALTER TABLE "invoice_number_blocks" DROP CONSTRAINT IF EXISTS "invoice_number_blocks_range";
ALTER TABLE "invoice_number_blocks" ADD CONSTRAINT "invoice_number_blocks_range" CHECK ("first" >= 1 AND "last" >= "first");
