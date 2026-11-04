import type { BusinessType, UnitKind } from "@prisma/client";

// ─────────────────────────────────────────────
// Profils métier
// ─────────────────────────────────────────────
// Le logiciel sert à tout commerce de détail ou de gros. Le métier choisi à
// l'inscription ne fait que PRÉ-REMPLIR : unités, catégories, caractéristiques
// suggérées et options de suivi. Tout reste modifiable produit par produit.
// Module sans dépendance serveur : utilisable côté navigateur.

export interface UnitPreset {
  name: string;
  symbol: string;
  kind: UnitKind;
  allowsDecimal: boolean;
}

export interface BusinessProfile {
  label: string;
  description: string;
  icon: string;
  /** Mot employé pour un produit dans l'interface. */
  productLabel: { singular: string; plural: string };
  units: UnitPreset[];
  /** Unité proposée par défaut à la création d'un produit (symbole). */
  defaultUnit: string;
  categories: string[];
  /** Caractéristiques suggérées dans la fiche produit (champs libres). */
  suggestedAttributes: string[];
  productDefaults: {
    trackBatches: boolean;
    requiresExpiry: boolean;
    requiresPrescription: boolean;
  };
  tax: { vatEnabled: boolean; defaultTaxRate: number };
  /** En caisse, la douchette code-barres est le mode de saisie principal. */
  barcodeFirst: boolean;
  /** Le client paie à la caisse puis se fait servir au magasin sur présentation de sa facture. */
  pickupByDefault?: boolean;
}

const U = (name: string, symbol: string, kind: UnitKind, allowsDecimal = false): UnitPreset => ({ name, symbol, kind, allowsDecimal });

const PIECE = U("Pièce", "pce", "COUNT");
const KG = U("Kilogramme", "kg", "WEIGHT", true);
const GRAM = U("Gramme", "g", "WEIGHT", true);
const LITRE = U("Litre", "L", "VOLUME", true);
const CARTON = U("Carton", "carton", "PACKAGING");
const SAC = U("Sac", "sac", "PACKAGING");

export const BUSINESS_PROFILES: Record<BusinessType, BusinessProfile> = {
  GENERAL: {
    label: "Commerce général",
    description: "Boutique, alimentation, divers",
    icon: "🏪",
    productLabel: { singular: "article", plural: "articles" },
    units: [PIECE, KG, LITRE, CARTON, SAC, U("Mètre", "m", "LENGTH", true)],
    defaultUnit: "pce",
    categories: ["Général"],
    suggestedAttributes: ["Marque", "Modèle"],
    productDefaults: { trackBatches: false, requiresExpiry: false, requiresPrescription: false },
    tax: { vatEnabled: false, defaultTaxRate: 0 },
    barcodeFirst: false,
  },
  FISHMONGER: {
    label: "Poissonnerie",
    description: "Poisson frais, congelé, fumé, fruits de mer",
    icon: "🐟",
    productLabel: { singular: "produit", plural: "produits" },
    // En poissonnerie, le carton se vend aussi au quart ou au demi (¼, ½, ¾)
    units: [KG, GRAM, U("Carton", "carton", "PACKAGING", true), U("Caisse", "caisse", "PACKAGING"), PIECE, SAC],
    defaultUnit: "kg",
    categories: ["Frais", "Congelé", "Fumé", "Séché", "Fruits de mer"],
    suggestedAttributes: ["Espèce", "Calibre", "Origine"],
    productDefaults: { trackBatches: false, requiresExpiry: false, requiresPrescription: false },
    tax: { vatEnabled: false, defaultTaxRate: 0 },
    barcodeFirst: false,
  },
  HARDWARE: {
    label: "Quincaillerie",
    description: "Outillage, plomberie, électricité, visserie, peinture",
    icon: "🔧",
    productLabel: { singular: "article", plural: "articles" },
    units: [
      PIECE,
      U("Boîte", "boîte", "PACKAGING"),
      U("Paquet", "paquet", "PACKAGING"),
      CARTON,
      U("Mètre", "m", "LENGTH", true),
      U("Rouleau", "rouleau", "PACKAGING"),
      U("Barre", "barre", "COUNT"),
      KG,
      LITRE,
      U("Pot", "pot", "PACKAGING"),
    ],
    defaultUnit: "pce",
    categories: ["Outillage", "Plomberie", "Électricité", "Visserie & fixation", "Peinture", "Quincaillerie générale"],
    suggestedAttributes: ["Dimension", "Matière", "Référence fabricant"],
    productDefaults: { trackBatches: false, requiresExpiry: false, requiresPrescription: false },
    tax: { vatEnabled: false, defaultTaxRate: 0 },
    barcodeFirst: false,
  },
  BUILDING_MATERIALS: {
    label: "Matériaux de construction",
    description: "Ciment, fer, sable, gravier, briques, bois",
    icon: "🧱",
    productLabel: { singular: "matériau", plural: "matériaux" },
    units: [
      SAC,
      U("Tonne", "t", "WEIGHT", true),
      KG,
      U("Mètre cube", "m³", "VOLUME", true),
      U("Mètre carré", "m²", "AREA", true),
      U("Barre", "barre", "COUNT"),
      PIECE,
      U("Voyage (camion)", "voyage", "PACKAGING"),
      U("Mètre", "m", "LENGTH", true),
    ],
    defaultUnit: "sac",
    categories: ["Ciment & liants", "Fer à béton", "Sable & gravier", "Briques & parpaings", "Bois & coffrage", "Carrelage"],
    suggestedAttributes: ["Diamètre", "Dimension", "Classe / qualité"],
    productDefaults: { trackBatches: false, requiresExpiry: false, requiresPrescription: false },
    tax: { vatEnabled: false, defaultTaxRate: 0 },
    pickupByDefault: true,
    barcodeFirst: false,
  },
  OIL_DISTRIBUTION: {
    label: "Vente d'huile",
    description: "Huile de palme, d'arachide, raffinée — au litre ou en bidon",
    icon: "🛢️",
    productLabel: { singular: "produit", plural: "produits" },
    units: [LITRE, U("Bidon", "bidon", "PACKAGING"), U("Bouteille", "bouteille", "PACKAGING"), U("Fût", "fût", "PACKAGING"), CARTON],
    defaultUnit: "L",
    categories: ["Huile de palme", "Huile d'arachide", "Huile raffinée", "Autres"],
    suggestedAttributes: ["Contenance", "Origine"],
    productDefaults: { trackBatches: false, requiresExpiry: false, requiresPrescription: false },
    tax: { vatEnabled: false, defaultTaxRate: 0 },
    barcodeFirst: false,
  },
  LUBRICANTS: {
    label: "Huiles moteur & lubrifiants",
    description: "Huiles moto, voiture, diesel, poids lourds — bouteille, bidon, seau, fût",
    icon: "🛢️",
    productLabel: { singular: "produit", plural: "produits" },
    units: [
      U("Bouteille 1 L", "btl", "PACKAGING"),
      U("Bidon", "bidon", "PACKAGING"),
      U("Seau 20 L", "seau", "PACKAGING"),
      U("Fût 208 L", "fût", "PACKAGING"),
      CARTON,
      LITRE,
      PIECE,
    ],
    defaultUnit: "btl",
    categories: ["Huiles moto", "Huiles voiture essence", "Huiles diesel", "Huiles poids lourds", "Huiles de boîte & pont", "Liquides & graisses"],
    suggestedAttributes: ["Marque", "Viscosité (SAE)", "Norme (API / ACEA)", "Contenance"],
    productDefaults: { trackBatches: false, requiresExpiry: false, requiresPrescription: false },
    tax: { vatEnabled: false, defaultTaxRate: 0 },
    barcodeFirst: false,
  },
  SUPERMARKET: {
    label: "Supermarché",
    description: "Alimentation, boissons, hygiène, entretien — caisse au code-barres",
    icon: "🛒",
    productLabel: { singular: "article", plural: "articles" },
    units: [PIECE, KG, LITRE, CARTON, U("Pack", "pack", "PACKAGING"), U("Paquet", "paquet", "PACKAGING")],
    defaultUnit: "pce",
    categories: ["Épicerie", "Boissons", "Produits frais", "Hygiène & beauté", "Entretien", "Bébé"],
    suggestedAttributes: ["Marque", "Contenance"],
    productDefaults: { trackBatches: false, requiresExpiry: false, requiresPrescription: false },
    tax: { vatEnabled: true, defaultTaxRate: 18 },
    barcodeFirst: true,
  },
  PHARMACY: {
    label: "Pharmacie",
    description: "Médicaments et parapharmacie — suivi des lots et des péremptions",
    icon: "💊",
    productLabel: { singular: "produit", plural: "produits" },
    units: [
      U("Boîte", "boîte", "PACKAGING"),
      U("Plaquette", "plaquette", "PACKAGING"),
      U("Comprimé", "cp", "COUNT"),
      U("Flacon", "flacon", "PACKAGING"),
      U("Tube", "tube", "PACKAGING"),
      U("Ampoule", "amp", "COUNT"),
      U("Sachet", "sachet", "COUNT"),
      PIECE,
    ],
    defaultUnit: "boîte",
    categories: ["Médicaments", "Parapharmacie", "Matériel médical", "Hygiène", "Bébé & maman"],
    suggestedAttributes: ["DCI", "Dosage", "Forme", "Laboratoire"],
    productDefaults: { trackBatches: true, requiresExpiry: true, requiresPrescription: false },
    tax: { vatEnabled: false, defaultTaxRate: 0 },
    barcodeFirst: true,
  },
  WHOLESALE: {
    label: "Grossiste / dépôt",
    description: "Vente en gros : cartons, sacs, palettes",
    icon: "📦",
    productLabel: { singular: "article", plural: "articles" },
    units: [CARTON, SAC, PIECE, KG, LITRE, U("Palette", "palette", "PACKAGING"), U("Pack", "pack", "PACKAGING")],
    defaultUnit: "carton",
    categories: ["Alimentaire", "Boissons", "Hygiène", "Divers"],
    suggestedAttributes: ["Marque", "Conditionnement"],
    productDefaults: { trackBatches: false, requiresExpiry: false, requiresPrescription: false },
    tax: { vatEnabled: false, defaultTaxRate: 0 },
    barcodeFirst: false,
  },
};

export const BUSINESS_TYPE_ORDER: BusinessType[] = [
  "GENERAL",
  "SUPERMARKET",
  "PHARMACY",
  "HARDWARE",
  "BUILDING_MATERIALS",
  "LUBRICANTS",
  "OIL_DISTRIBUTION",
  "FISHMONGER",
  "WHOLESALE",
];

export function getBusinessProfile(type: BusinessType | string | null | undefined): BusinessProfile {
  return BUSINESS_PROFILES[(type as BusinessType) ?? "GENERAL"] ?? BUSINESS_PROFILES.GENERAL;
}
