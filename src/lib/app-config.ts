// Édition dédiée GRACES JUMELLES HOUSE (GJH) : un seul client, un seul métier
// (vente d'huiles moteur et lubrifiants), logo GJH partout.
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "GJH Gestion";
export const APP_TAGLINE = "Huiles moteur & lubrifiants — caisse, stock et suivi en direct";
export const COMPANY_NAME = "GRACES JUMELLES HOUSE";
/** Seuil fixe « stock presque épuisé » (en unité de vente de l'article : bouteille, bidon…). */
export const LOW_STOCK_THRESHOLD = 7;
/** Inscription de nouvelles entreprises : fermée (logiciel réservé à GJH). */
export const REGISTRATION_OPEN = process.env.NEXT_PUBLIC_REGISTRATION_OPEN === "1";
/** Côté serveur (relu à chaque appel). */
export const registrationOpen = () => process.env.REGISTRATION_OPEN === "1" || process.env.NEXT_PUBLIC_REGISTRATION_OPEN === "1";
/** Contact de l'assistance de la plateforme (WhatsApp, téléphone…), affiché aux propriétaires. */
export const SUPPORT_CONTACT = process.env.NEXT_PUBLIC_SUPPORT_CONTACT || "";
