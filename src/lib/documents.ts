import type { Prisma } from "@prisma/client";

/** Champs de l'entreprise imprimés en en-tête des documents A4. */
export const docCompanySelect = {
  tradeName: true,
  legalName: true,
  logoUrl: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  poBox: true,
  taxId: true,
  tradeRegNumber: true,
  currency: true,
  vatEnabled: true,
  invoiceNotes: true,
} satisfies Prisma.CompanySelect;

/** Champs du centre imprimés en en-tête des documents A4. */
export const docCenterSelect = { name: true, address: true, city: true, phone: true } satisfies Prisma.CenterSelect;
