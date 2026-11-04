import { z } from "zod";

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide"),
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
  email: z.string().trim().toLowerCase().email("Email invalide"),
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
  businessType: z
    .enum(["GENERAL", "FISHMONGER", "HARDWARE", "BUILDING_MATERIALS", "OIL_DISTRIBUTION", "LUBRICANTS", "SUPERMARKET", "PHARMACY", "WHOLESALE"])
    .default("GENERAL"),
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
  email: z.string().trim().toLowerCase().email("Email invalide"),
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
  password: z
    .string()
    .min(8, "Mot de passe : min. 8 caractères")
    .regex(/[A-Z]/, "Au moins une majuscule")
    .regex(/[0-9]/, "Au moins un chiffre"),
});

/** Règle commune des mots de passe. */
export const passwordRule = z
  .string()
  .min(8, "Mot de passe : min. 8 caractères")
  .max(128, "Mot de passe trop long")
  .regex(/[A-Z]/, "Au moins une majuscule")
  .regex(/[0-9]/, "Au moins un chiffre");

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis").optional(),
  lastName: z.string().trim().min(1, "Nom requis").optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  role: createUserSchema.shape.role.optional(),
  centerIds: z.array(z.string()).min(1, "Affecter au moins un centre").optional(),
  isActive: z.boolean().optional(),
});

export const passwordResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordRule,
});

// ─────────────────────────────────────────────
// PRODUIT
// ─────────────────────────────────────────────

/** Conditionnement vendable : 1 <unité> = factor × unité de base du produit. */
export const packagingSchema = z.object({
  unitId: z.string().min(1, "Unité du conditionnement requise"),
  factor: z.coerce.number().positive("Contenance invalide"),
  sellingPrice: z.coerce.number().min(0).optional().nullable(),
  barcode: z.string().trim().optional().nullable(),
});

/** Caractéristiques libres : { "Dosage": "500 mg", "Espèce": "Tilapia" } */
export const attributesSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().max(120))
  .refine((r) => Object.keys(r).length <= 20, "20 caractéristiques au maximum");

export const productSchema = z.object({
  name: z.string().trim().min(1, "Nom du produit requis"),
  internalCode: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  categoryId: z.string().optional().nullable(),
  baseUnitId: z.string().min(1, "Unité principale requise"),
  purchasePrice: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0),
  stockAlertQty: z.coerce.number().min(0),
  description: z.string().optional(),
  attributes: attributesSchema.optional(),
  // Non fournis → valeurs par défaut du profil métier de l'entreprise
  trackBatches: z.boolean().optional(),
  requiresExpiry: z.boolean().optional(),
  requiresPrescription: z.boolean().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  packagings: z.array(packagingSchema).max(10).optional(),
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
  // Vente issue d'un devis : les lignes et les prix sont repris du devis par le serveur
  quoteId: z.string().optional(),
  // Numéro attribué par la caisse dans sa plage (imprimé avant même l'envoi au serveur)
  invoiceSeq: z.number().int().positive().optional(),
  // Heure réelle d'une vente faite hors connexion (celle imprimée sur le ticket)
  soldAt: z.string().datetime().optional(),
  lines: z.array(saleLineSchema).default([]),
  payments: z.array(
    z.object({
      method: z.enum(["CASH", "MOBILE_MONEY", "CARD", "TRANSFER"]),
      amount: z.coerce.number().positive(),
      reference: z.string().optional(),
    })
  ).min(1, "Au moins un paiement"),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(1),
  createdOffline: z.boolean().default(false),
  deviceId: z.string().optional(),
}).refine((d) => d.lines.length > 0 || !!d.quoteId, { message: "Au moins un produit", path: ["lines"] });

// ─────────────────────────────────────────────
// Clients, devis, retraits
// ─────────────────────────────────────────────

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Nom du client requis").max(100),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().email("Email invalide").optional().or(z.literal("")),
  address: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(30).optional(),
});

export const customerUpdateSchema = customerSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, "Aucune modification");

export const quoteSchema = z.object({
  centerId: z.string().min(1),
  customerId: z.string().min(1, "Client requis"),
  validityDays: z.coerce.number().int().min(1).max(365).optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(saleLineSchema).min(1, "Au moins un article").max(200),
});

export const deliverySchema = z.object({
  lines: z
    .array(z.object({ saleLineId: z.string().min(1), quantity: z.coerce.number().positive() }))
    .min(1, "Rien à remettre"),
  notes: z.string().trim().max(500).optional(),
});

// ─────────────────────────────────────────────
// INVENTAIRES & TRANSFERTS
// ─────────────────────────────────────────────

export const inventoryCreateSchema = z.object({
  centerId: z.string().min(1, "Centre requis"),
  label: z.string().trim().max(120).optional(),
  /** Limiter le comptage à des familles d'articles (vide = tout le catalogue actif). */
  categoryIds: z.array(z.string().min(1)).max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const inventoryCountSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        /** null = remettre la ligne « non comptée » */
        countedQty: z.union([z.coerce.number().min(0, "Quantité comptée négative"), z.null()]),
        reason: z.string().trim().max(200).optional(),
      })
    )
    .min(1, "Aucune quantité saisie")
    .max(2000),
});

export const inventoryValidateSchema = z.object({
  /** Articles non comptés : laissés tels quels (défaut) ou mis à zéro. */
  uncounted: z.enum(["keep", "zero"]).default("keep"),
});

export const transferCreateSchema = z
  .object({
    fromCenterId: z.string().min(1, "Centre d'origine requis"),
    toCenterId: z.string().min(1, "Centre de destination requis"),
    notes: z.string().trim().max(500).optional(),
    lines: z
      .array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().positive("Quantité invalide") }))
      .min(1, "Ajoutez au moins un article")
      .max(500),
  })
  .refine((d) => d.fromCenterId !== d.toCenterId, { message: "Origine et destination doivent être différentes", path: ["toCenterId"] })
  .refine((d) => new Set(d.lines.map((l) => l.productId)).size === d.lines.length, { message: "Un article apparaît deux fois", path: ["lines"] });

export const transferReceiveSchema = z.object({
  /** Quantités réellement reçues par ligne ; absentes = tout reçu. */
  lines: z.array(z.object({ lineId: z.string().min(1), receivedQty: z.coerce.number().min(0) })).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const cancelReasonSchema = z.object({
  reason: z.string().trim().min(3, "Motif obligatoire (min. 3 caractères)").max(300),
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
  packageCount: z.coerce.number().int().min(0).optional(),
  grossWeight: z.coerce.number().min(0).optional(),
  quantity: z.coerce.number().positive("Quantité reçue invalide"), // unité de base
  unitId: z.string().optional(),
  unitPrice: z.coerce.number().min(0),
  totalPrice: z.coerce.number().min(0),
  lotNumber: z.string().trim().max(60).optional(),
  expiresAt: z.coerce.date().optional(),
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
