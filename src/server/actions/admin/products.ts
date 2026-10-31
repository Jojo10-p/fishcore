"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { slugify } from "@/lib/utils";
import { DOCUMENT_TYPES } from "@/lib/status";
import type { ActionState } from "@/components/ui/form-status";

const num = (label: string) => z.coerce.number({ invalid_type_error: `${label} invalide` }).finite().min(0, `${label} invalide`);

const productSchema = z
  .object({
    id: z.string().uuid().optional().or(z.literal("")),
    name: z.string().trim().min(3, "Nom requis").max(120),
    slug: z.string().trim().max(120).optional(),
    category: z.enum(["PERSONAL", "PROFESSIONAL", "REAL_ESTATE", "PROJECT", "CUSTOM"]),
    tagline: z.string().trim().max(160).optional(),
    description: z.string().trim().min(20, "Description trop courte").max(5000),
    minAmount: num("Montant minimum"),
    maxAmount: num("Montant maximum"),
    minDurationMonths: z.coerce.number().int().min(1, "Durée minimale invalide").max(480),
    maxDurationMonths: z.coerce.number().int().min(1, "Durée maximale invalide").max(480),
    annualRate: z.coerce.number({ invalid_type_error: "Taux requis" }).min(0, "Taux invalide").max(100, "Taux invalide"),
    feesFixed: num("Frais fixes"),
    feesPercent: num("Frais proportionnels").max(100),
    insuranceRate: num("Taux d'assurance").max(100),
    eligibility: z.string().max(5000).optional(),
    requiredDocuments: z.string(),
    isActive: z.string().optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine((d) => d.maxAmount >= d.minAmount && d.minAmount > 0, { path: ["maxAmount"], message: "Le maximum doit être ≥ au minimum (> 0)" })
  .refine((d) => d.maxDurationMonths >= d.minDurationMonths, { path: ["maxDurationMonths"], message: "La durée maximale doit être ≥ à la minimale" });

const docsSchema = z.array(z.object({ key: z.string().refine((k) => k in DOCUMENT_TYPES), label: z.string().trim().min(2).max(120), required: z.boolean() })).max(15);

export async function saveProduct(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await assertStaff("products.manage");
  const parsed = productSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Vérifiez les champs signalés.", errors: parsed.error.flatten().fieldErrors };
  let docs: z.infer<typeof docsSchema>;
  try {
    docs = docsSchema.parse(JSON.parse(parsed.data.requiredDocuments || "[]"));
  } catch {
    return { ok: false, message: "Liste des documents requis invalide.", errors: { requiredDocuments: ["Chaque document doit avoir un intitulé"] } };
  }
  const d = parsed.data;
  const slug = slugify(d.slug || d.name);
  const clash = await db.loanProduct.findFirst({ where: { slug, ...(d.id ? { NOT: { id: d.id } } : {}) } });
  if (clash) return { ok: false, message: "Cet identifiant d'URL est déjà utilisé.", errors: { slug: ["Déjà utilisé"] } };
  const data = {
    name: d.name,
    slug,
    category: d.category,
    tagline: d.tagline || null,
    description: d.description,
    minAmount: d.minAmount,
    maxAmount: d.maxAmount,
    minDurationMonths: d.minDurationMonths,
    maxDurationMonths: d.maxDurationMonths,
    annualRate: d.annualRate,
    feesFixed: d.feesFixed,
    feesPercent: d.feesPercent,
    insuranceRate: d.insuranceRate,
    eligibility: (d.eligibility ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20),
    requiredDocuments: docs,
    isActive: d.isActive === "on",
    sortOrder: d.sortOrder,
  };
  if (d.id) {
    const before = await db.loanProduct.findUnique({ where: { id: d.id } });
    if (!before) return { ok: false, message: "Offre introuvable." };
    await db.loanProduct.update({ where: { id: d.id }, data });
    await audit({ actorId: user.id, action: "product.updated", entity: "LoanProduct", entityId: d.id, metadata: { annualRate: { from: Number(before.annualRate), to: d.annualRate }, isActive: data.isActive } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Offre enregistrée." };
  }
  const p = await db.loanProduct.create({ data });
  await audit({ actorId: user.id, action: "product.created", entity: "LoanProduct", entityId: p.id, metadata: { name: p.name } });
  revalidatePath("/", "layout");
  redirect(`/admin/offres/${p.id}?created=1`);
}

export async function toggleProduct(id: string, active: boolean) {
  const user = await assertStaff("products.manage");
  await db.loanProduct.update({ where: { id }, data: { isActive: active } });
  await audit({ actorId: user.id, action: active ? "product.activated" : "product.deactivated", entity: "LoanProduct", entityId: id });
  revalidatePath("/", "layout");
  return { ok: true, message: active ? "Offre activée." : "Offre désactivée." };
}

export async function archiveProduct(id: string) {
  const user = await assertStaff("products.manage");
  const count = await db.loanApplication.count({ where: { productId: id } });
  if (count === 0) {
    await db.loanProduct.delete({ where: { id } });
    await audit({ actorId: user.id, action: "product.deleted", entity: "LoanProduct", entityId: id });
  } else {
    await db.loanProduct.update({ where: { id }, data: { archivedAt: new Date(), isActive: false } });
    await audit({ actorId: user.id, action: "product.archived", entity: "LoanProduct", entityId: id });
  }
  revalidatePath("/", "layout");
  redirect("/admin/offres");
}

export async function restoreProduct(id: string) {
  const user = await assertStaff("products.manage");
  await db.loanProduct.update({ where: { id }, data: { archivedAt: null } });
  await audit({ actorId: user.id, action: "product.restored", entity: "LoanProduct", entityId: id });
  revalidatePath("/admin/offres");
  return { ok: true, message: "Offre restaurée (inactive)." };
}
