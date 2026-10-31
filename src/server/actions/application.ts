"use server";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { fullApplicationSchema, checkProductBounds } from "@/lib/validation/application";
import { simulate } from "@/lib/loan-math";
import { formatMoney, toNumber } from "@/lib/utils";
import { DOCUMENT_TYPES } from "@/lib/status";
import { getCurrentUser, createSession } from "@/server/auth/session";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import { inspectUpload, storePrivate, deletePrivate, UploadError } from "@/server/storage";
import { rateLimit } from "@/server/rate-limit";
import { requestMeta } from "@/server/request";
import { audit } from "@/server/audit";
import { notifyStaff, notifyUser } from "@/server/notify";
import { sendTemplatedEmail } from "@/server/mail";
import { getSettings } from "@/server/settings";

export type SubmitState = { ok: false; message: string; errors?: Record<string, string[] | undefined>; step?: number } | undefined;

const MAX_FILES = 8;
const MAX_TOTAL = 36 * 1024 * 1024;

function reference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `AF-${new Date().getFullYear()}-${code}`;
}

const STEP_OF: Record<string, number> = {
  lastName: 0, firstName: 0, birthDate: 0, nationality: 0, email: 0, phone: 0, country: 0, city: 0, address: 0,
  profession: 1, employmentStatus: 1, employer: 1, monthlyIncome: 1, monthlyCharges: 1,
  productId: 2, amount: 2, durationMonths: 2, purpose: 2, description: 2,
  password: 4, acceptTerms: 4, acceptData: 4,
};

export async function submitApplication(_: SubmitState, form: FormData): Promise<SubmitState> {
  const meta = await requestMeta();
  if (!(await rateLimit(`apply:${meta.ip}`, 6, 3600))) return { ok: false, message: "Trop de demandes envoyées depuis cette connexion. Réessayez plus tard." };

  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = fullApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const first = Object.keys(errors)[0];
    return { ok: false, message: "Certaines informations sont incomplètes.", errors, step: STEP_OF[first] ?? 0 };
  }
  const data = parsed.data;

  // Offre active + bornes
  const product = await db.loanProduct.findFirst({ where: { id: data.productId, isActive: true, archivedAt: null } });
  if (!product) return { ok: false, message: "Cette offre n'est plus disponible.", step: 2 };
  const bounds = checkProductBounds(
    { minAmount: toNumber(product.minAmount), maxAmount: toNumber(product.maxAmount), minDurationMonths: product.minDurationMonths, maxDurationMonths: product.maxDurationMonths },
    data.amount,
    data.durationMonths,
  );
  if (Object.keys(bounds).length) return { ok: false, message: "Le montant ou la durée sort des limites de l'offre.", errors: Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, [v]])), step: 2 };

  // Compte : connecté, ou création à la soumission
  const current = await getCurrentUser();
  if (current && current.type !== "CUSTOMER") return { ok: false, message: "Les comptes administrateurs ne peuvent pas déposer de demande." };
  let newPasswordHash: string | null = null;
  if (!current) {
    const pw = passwordSchema.safeParse(form.get("password"));
    if (!pw.success) return { ok: false, message: "Choisissez un mot de passe valide pour votre espace de suivi.", errors: { password: pw.error.flatten().formErrors }, step: 4 };
    if (form.get("password") !== form.get("passwordConfirm")) return { ok: false, message: "Les mots de passe ne correspondent pas.", errors: { passwordConfirm: ["Les mots de passe ne correspondent pas"] }, step: 4 };
    if (await db.user.findUnique({ where: { email: data.email } })) {
      return { ok: false, message: "Un compte existe déjà avec cet email. Connectez-vous pour déposer votre demande : votre saisie est conservée.", errors: { email: ["Compte existant — connectez-vous"] }, step: 0 };
    }
    newPasswordHash = await hashPassword(pw.data);
  }

  // Fichiers : signature binaire vérifiée, stockage privé
  const required = (Array.isArray(product.requiredDocuments) ? product.requiredDocuments : []) as { key: string; label: string; required: boolean }[];
  const files: { type: string; label: string; file: File }[] = [];
  for (const [name, value] of form.entries()) {
    if (!(value instanceof File) || value.size === 0) continue;
    if (!name.startsWith("doc_")) continue;
    const key = name.slice(4);
    const spec = required.find((r) => r.key === key);
    files.push({ type: spec ? spec.key : "other", label: spec?.label ?? DOCUMENT_TYPES.other, file: value });
  }
  if (files.length > MAX_FILES) return { ok: false, message: `${MAX_FILES} fichiers maximum.`, step: 3 };
  if (files.reduce((s, f) => s + f.file.size, 0) > MAX_TOTAL) return { ok: false, message: "Volume total des fichiers trop important (36 Mo maximum).", step: 3 };
  const stored: { type: string; originalName: string; mime: string; size: number; key: string; sha256: string }[] = [];
  try {
    for (const f of files) {
      const info = await inspectUpload(f.file);
      const s = await storePrivate(info.buffer, info.ext);
      stored.push({ type: f.type, originalName: info.originalName, mime: info.mime, size: info.size, key: s.key, sha256: s.sha256 });
    }
  } catch (e) {
    await Promise.all(stored.map((s) => deletePrivate(s.key)));
    if (e instanceof UploadError) return { ok: false, message: e.message, step: 3 };
    throw e;
  }

  const sim = simulate({
    amount: data.amount,
    durationMonths: data.durationMonths,
    annualRate: toNumber(product.annualRate),
    feesFixed: toNumber(product.feesFixed),
    feesPercent: toNumber(product.feesPercent),
    insuranceRate: toNumber(product.insuranceRate),
  });
  const now = new Date();
  const missing = required.filter((r) => r.required && !stored.some((s) => s.type === r.key));

  let created: { applicationId: string; reference: string; userId: string; customerId: string };
  try {
    created = await db.$transaction(async (tx) => {
      let userId = current?.id;
      if (!userId) {
        const u = await tx.user.create({ data: { email: data.email, passwordHash: newPasswordHash!, firstName: data.firstName, lastName: data.lastName, phone: data.phone, type: "CUSTOMER" } });
        userId = u.id;
      }
      const profile = {
        firstName: data.firstName,
        lastName: data.lastName,
        birthDate: new Date(data.birthDate),
        nationality: data.nationality || null,
        email: current?.email ?? data.email,
        phone: data.phone,
        country: data.country,
        city: data.city,
        address: data.address,
        profession: data.profession,
        employmentStatus: data.employmentStatus,
        employer: data.employer || null,
        monthlyIncome: data.monthlyIncome,
        monthlyCharges: data.monthlyCharges,
      };
      const customer = current?.customer
        ? await tx.customer.update({ where: { id: current.customer.id }, data: profile })
        : await tx.customer.create({ data: { ...profile, userId } });

      let ref = reference();
      while (await tx.loanApplication.findUnique({ where: { reference: ref } })) ref = reference();

      const app = await tx.loanApplication.create({
        data: {
          reference: ref,
          customerId: customer.id,
          productId: product.id,
          amount: data.amount,
          durationMonths: data.durationMonths,
          purpose: data.purpose,
          description: data.description,
          status: "NEW",
          termsSnapshot: {
            productName: product.name,
            annualRate: toNumber(product.annualRate),
            feesFixed: toNumber(product.feesFixed),
            feesPercent: toNumber(product.feesPercent),
            insuranceRate: toNumber(product.insuranceRate),
            simulation: sim,
          } as never,
          applicantSnapshot: { ...profile, birthDate: data.birthDate } as never,
          consentTermsAt: now,
          consentDataAt: now,
          submittedIp: meta.ip,
          statusHistory: { create: { toStatus: "NEW", publicComment: "Demande déposée en ligne." } },
          documentRequests: missing.length ? { create: missing.map((m) => ({ label: m.label, message: "Document non transmis lors du dépôt." })) } : undefined,
        },
      });
      if (stored.length) {
        await tx.applicationDocument.createMany({
          data: stored.map((s) => ({ customerId: customer.id, applicationId: app.id, type: s.type, originalName: s.originalName, storageKey: s.key, mimeType: s.mime, size: s.size, sha256: s.sha256, uploadedById: userId })),
        });
      }
      return { applicationId: app.id, reference: ref, userId: userId!, customerId: customer.id };
    });
  } catch (e) {
    await Promise.all(stored.map((s) => deletePrivate(s.key)));
    if (e instanceof z.ZodError) return { ok: false, message: "Données invalides." };
    throw e;
  }

  await audit({ actorId: created.userId, action: "application.submitted", entity: "LoanApplication", entityId: created.applicationId, metadata: { reference: created.reference, documents: stored.length } });

  const settings = await getSettings();
  const amountStr = formatMoney(data.amount, settings.locale.currency, settings.locale.numberLocale);
  if (!current) {
    await sendTemplatedEmail({ to: data.email, templateKey: "welcome", vars: { firstName: data.firstName }, userId: created.userId });
  }
  await notifyUser(created.userId, {
    title: `Demande ${created.reference} déposée`,
    body: missing.length ? `Votre demande est enregistrée. ${missing.length} justificatif(s) restent à transmettre.` : "Votre demande est enregistrée et va être étudiée.",
    link: `/espace/demandes/${created.applicationId}`,
    email: { templateKey: "application_received", vars: { reference: created.reference, productName: product.name, amount: amountStr, duration: String(data.durationMonths), applicationId: created.applicationId } },
  });
  await notifyStaff("applications.view", {
    title: `Nouvelle demande ${created.reference}`,
    body: `${data.firstName} ${data.lastName} — ${product.name}, ${amountStr}`,
    link: `/admin/demandes/${created.applicationId}`,
    email: { templateKey: "application_admin_alert", vars: { reference: created.reference, customerName: `${data.firstName} ${data.lastName}`, productName: product.name, amount: amountStr, duration: String(data.durationMonths), applicationId: created.applicationId } },
  });

  if (!current) await createSession({ id: created.userId, type: "CUSTOMER" });
  redirect(`/demande/confirmation?ref=${encodeURIComponent(created.reference)}`);
}
