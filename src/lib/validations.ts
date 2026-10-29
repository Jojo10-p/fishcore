import { z } from "zod";

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis"),
    newPassword: z
      .string()
      .min(8, "Au moins 8 caractères")
      .regex(/[A-Z]/, "Au moins une majuscule")
      .regex(/[0-9]/, "Au moins un chiffre"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

// ─────────────────────────────────────────────
// ENTREPRISE
// ─────────────────────────────────────────────

export const companySchema = z.object({
  tradeName: z.string().min(2, "Nom commercial requis (min. 2 caractères)"),
  legalName: z.string().optional(),
  ownerName: z.string().min(2, "Nom du propriétaire requis"),
  phone: z.string().min(8, "Numéro de téléphone invalide"),
  email: z.string().email("Email invalide"),
  address: z.string().optional(),
  city: z.string().optional(),
  commune: z.string().optional(),
  country: z.string().default("BJ"),
  poBox: z.string().optional(),
  taxId: z.string().optional(),
  tradeRegNumber: z.string().optional(),
  currency: z.string().default("XOF"),
  timezone: z.string().default("Africa/Porto-Novo"),
  invoicePrefix: z.string().default("FACT"),
  password: z
    .string()
    .min(8, "Mot de passe : min. 8 caractères")
    .regex(/[A-Z]/, "Au moins une majuscule")
    .regex(/[0-9]/, "Au moins un chiffre"),
});

// ─────────────────────────────────────────────
// CENTRE / AGENCE
// ─────────────────────────────────────────────

export const centerSchema = z.object({
  name: z.string().min(2, "Nom du centre requis"),
  code: z
    .string()
    .min(2, "Code requis")
    .max(10, "Code trop long")
    .regex(/^[A-Z0-9_-]+$/, "Code : lettres majuscules, chiffres, tirets uniquement"),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  managerId: z.string().optional(),
});

// ─────────────────────────────────────────────
// UTILISATEUR
// ─────────────────────────────────────────────

export const createUserSchema = z.object({
  firstName: z.string().min(1, "Prénom requis"),
  lastName: z.string().min(1, "Nom requis"),
  email: z.string().email("Email invalide"),
  phone: z.string().optional(),
  role: z.enum([
    "COMPANY_OWNER",
    "CENTER_MANAGER",
    "CASHIER",
    "ACCOUNTANT",
    "STOCK_MANAGER",
    "SALES_EMPLOYEE",
  ]),
  centerIds: z.array(z.string()).min(1, "Affecter au moins un centre"),
  password: z.string().min(8, "Mot de passe : min. 8 caractères"),
});

// ─────────────────────────────────────────────
// PRODUIT
// ─────────────────────────────────────────────

export const productSchema = z.object({
  name: z.string().min(1, "Nom du produit requis"),
  internalCode: z.string().optional(),
  barcode: z.string().optional(),
  species: z.string().optional(),
  type: z.enum(["FRESH", "FROZEN", "SMOKED", "DRIED", "OTHER"]),
  baseUnitId: z.string().min(1, "Unité principale requise"),
  purchasePrice: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0),
  stockAlertQty: z.coerce.number().min(0),
  description: z.string().optional(),
});

// ─────────────────────────────────────────────
// VENTE
// ─────────────────────────────────────────────

export const saleLineSchema = z.object({
  productId: z.string().min(1, "Produit requis"),
  quantity: z.coerce.number().positive("Quantité invalide"),
  unitId: z.string().optional(),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
});

export const createSaleSchema = z.object({
  sessionId: z.string().min(1),
  customerId: z.string().optional(),
  lines: z.array(saleLineSchema).min(1, "Au moins un produit"),
  payments: z.array(
    z.object({
      method: z.enum(["CASH", "MOBILE_MONEY", "CARD", "TRANSFER", "MIXED", "CREDIT"]),
      amount: z.coerce.number().positive(),
      reference: z.string().optional(),
    })
  ).min(1, "Au moins un paiement"),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(1),
  createdOffline: z.boolean().default(false),
  deviceId: z.string().optional(),
});

// ─────────────────────────────────────────────
// CAISSE
// ─────────────────────────────────────────────

export const openSessionSchema = z.object({
  cashRegisterId: z.string().min(1, "Caisse requise"),
  openingBalance: z.coerce.number().min(0, "Fond de caisse invalide"),
  deviceId: z.string().optional(),
});

export const closeSessionSchema = z.object({
  sessionId: z.string().min(1),
  declaredBalance: z.coerce.number().min(0, "Montant compté invalide"),
  notes: z.string().optional(),
});

// ─────────────────────────────────────────────
// RÉCEPTION MARCHANDISE
// ─────────────────────────────────────────────

export const goodsReceiptLineSchema = z.object({
  productId: z.string().min(1, "Produit requis"),
  cartonCount: z.coerce.number().int().optional(),
  grossWeight: z.coerce.number().optional(),
  netWeight: z.coerce.number().positive("Poids net invalide"),
  unitId: z.string().optional(),
  unitPrice: z.coerce.number().min(0),
  totalPrice: z.coerce.number().min(0),
});

export const goodsReceiptSchema = z.object({
  centerId: z.string().min(1),
  supplierId: z.string().optional(),
  purchaseId: z.string().optional(),
  reference: z.string().optional(),
  receivedAt: z.coerce.date().default(() => new Date()),
  transportCost: z.coerce.number().min(0).default(0),
  iceCost: z.coerce.number().min(0).default(0),
  handlingCost: z.coerce.number().min(0).default(0),
  otherCosts: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
  lines: z.array(goodsReceiptLineSchema).min(1, "Au moins un produit"),
});

// ─────────────────────────────────────────────
// ANNULATION
// ─────────────────────────────────────────────

export const cancellationRequestSchema = z.object({
  saleId: z.string().min(1),
  requestReason: z.string().min(5, "Motif requis (min. 5 caractères)"),
});

export const cancellationDecisionSchema = z.object({
  cancellationId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().optional(),
});

// ─────────────────────────────────────────────
// LIEN D'INSTALLATION AGENCE
// ─────────────────────────────────────────────

export const generateInstallLinkSchema = z.object({
  centerId: z.string().min(1, "Centre requis"),
  expiresInHours: z.coerce.number().int().min(1).max(168).default(72), // 72h par défaut, max 7 jours
});

// Types inférés
export type LoginInput = z.infer<typeof loginSchema>;
export type CompanyInput = z.infer<typeof companySchema>;
export type CenterInput = z.infer<typeof centerSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type OpenSessionInput = z.infer<typeof openSessionSchema>;
export type CloseSessionInput = z.infer<typeof closeSessionSchema>;
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;
export type CancellationRequestInput = z.infer<typeof cancellationRequestSchema>;
export type CancellationDecisionInput = z.infer<typeof cancellationDecisionSchema>;
export type GenerateInstallLinkInput = z.infer<typeof generateInstallLinkSchema>;
