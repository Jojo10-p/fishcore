import type { ApplicationStatus, DocumentStatus, TicketStatus, ProductCategory } from "@/generated/prisma/enums";

export const APPLICATION_STATUSES: ApplicationStatus[] = ["NEW", "UNDER_REVIEW", "MISSING_DOCUMENTS", "ON_HOLD", "APPROVED", "REJECTED", "CLOSED"];

export const APPLICATION_STATUS_META: Record<ApplicationStatus, { label: string; tone: "info" | "teal" | "amber" | "slate" | "green" | "red" | "muted"; color: string }> = {
  NEW: { label: "Nouveau", tone: "info", color: "#3B82F6" },
  UNDER_REVIEW: { label: "En cours d'analyse", tone: "teal", color: "#20B6A5" },
  MISSING_DOCUMENTS: { label: "Documents manquants", tone: "amber", color: "#D9952B" },
  ON_HOLD: { label: "En attente", tone: "slate", color: "#8592A8" },
  APPROVED: { label: "Approuvé", tone: "green", color: "#16A34A" },
  REJECTED: { label: "Refusé", tone: "red", color: "#DC4B4B" },
  CLOSED: { label: "Clôturé", tone: "muted", color: "#263B58" },
};

export const DECISION_STATUSES: ApplicationStatus[] = ["APPROVED", "REJECTED"];

export const DOCUMENT_STATUS_META: Record<DocumentStatus, { label: string; tone: "amber" | "green" | "red" }> = {
  PENDING: { label: "En vérification", tone: "amber" },
  ACCEPTED: { label: "Validé", tone: "green" },
  REJECTED: { label: "Refusé", tone: "red" },
};

export const TICKET_STATUS_META: Record<TicketStatus, { label: string; tone: "info" | "teal" | "muted" }> = {
  OPEN: { label: "Ouvert", tone: "info" },
  ANSWERED: { label: "Répondu", tone: "teal" },
  CLOSED: { label: "Fermé", tone: "muted" },
};

export const CATEGORY_META: Record<ProductCategory, { fr: string; en: string }> = {
  PERSONAL: { fr: "Crédit personnel", en: "Personal loan" },
  PROFESSIONAL: { fr: "Crédit professionnel", en: "Business loan" },
  REAL_ESTATE: { fr: "Crédit immobilier", en: "Mortgage" },
  PROJECT: { fr: "Financement de projets", en: "Project financing" },
  CUSTOM: { fr: "Solutions personnalisées", en: "Tailored solutions" },
};

export const DOCUMENT_TYPES: Record<string, string> = {
  identity: "Pièce d'identité",
  income: "Justificatif de revenus",
  address: "Justificatif de domicile",
  bank: "Relevé bancaire",
  business: "Documents d'entreprise",
  project: "Dossier de projet",
  other: "Document complémentaire",
};
