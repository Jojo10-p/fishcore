import { z } from "zod";

const money = z.coerce.number({ invalid_type_error: "Montant invalide" }).finite().min(0, "Montant invalide").max(1e10);

export const identitySchema = z.object({
  lastName: z.string().trim().min(2, "Nom requis").max(80),
  firstName: z.string().trim().min(2, "Prénom(s) requis").max(120),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide")
    .refine((d) => {
      const b = new Date(d);
      const age = (Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000);
      return age >= 18 && age < 110;
    }, "Vous devez être majeur(e)"),
  nationality: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email("Email invalide").max(200),
  phone: z.string().trim().min(6, "Téléphone invalide").max(30).regex(/^[+0-9 ().-]+$/, "Téléphone invalide"),
  country: z.string().trim().min(2, "Pays requis").max(80),
  city: z.string().trim().min(2, "Ville requise").max(80),
  address: z.string().trim().min(4, "Adresse requise").max(250),
});

export const EMPLOYMENT_STATUSES = ["Salarié(e) CDI", "Salarié(e) CDD", "Fonctionnaire", "Indépendant(e)", "Chef d'entreprise", "Profession libérale", "Retraité(e)", "Étudiant(e)", "Sans emploi", "Autre"] as const;

export const professionalSchema = z.object({
  profession: z.string().trim().min(2, "Profession requise").max(120),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES, { errorMap: () => ({ message: "Choisissez une situation" }) }),
  employer: z.string().trim().max(150).optional().or(z.literal("")),
  monthlyIncome: money.refine((n) => n > 0, "Indiquez vos revenus mensuels"),
  monthlyCharges: money,
});

export const financingSchema = z.object({
  productId: z.string().uuid("Choisissez une offre"),
  amount: z.coerce.number({ invalid_type_error: "Montant invalide" }).positive("Montant invalide"),
  durationMonths: z.coerce.number().int("Durée invalide").positive("Durée invalide"),
  purpose: z.string().trim().min(3, "Objet requis").max(150),
  description: z.string().trim().min(20, "Décrivez votre projet (20 caractères minimum)").max(4000),
});

export const consentSchema = z.object({
  acceptTerms: z.literal("on", { errorMap: () => ({ message: "Vous devez accepter les conditions" }) }),
  acceptData: z.literal("on", { errorMap: () => ({ message: "Votre consentement est nécessaire" }) }),
});

export const fullApplicationSchema = identitySchema.merge(professionalSchema).merge(financingSchema).merge(consentSchema);
export type ApplicationInput = z.infer<typeof fullApplicationSchema>;

/** Contrôle des bornes de l'offre — utilisé côté client et côté serveur. */
export function checkProductBounds(p: { minAmount: number; maxAmount: number; minDurationMonths: number; maxDurationMonths: number }, amount: number, duration: number) {
  const errors: Record<string, string> = {};
  if (amount < p.minAmount || amount > p.maxAmount) errors.amount = `Montant entre ${p.minAmount.toLocaleString("fr-FR")} et ${p.maxAmount.toLocaleString("fr-FR")}`;
  if (duration < p.minDurationMonths || duration > p.maxDurationMonths) errors.durationMonths = `Durée entre ${p.minDurationMonths} et ${p.maxDurationMonths} mois`;
  return errors;
}
