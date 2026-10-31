"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff, getCurrentUser, revokeAllSessions } from "@/server/auth/session";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { notifyUser } from "@/server/notify";
import { inspectUpload, storeMedia, UploadError } from "@/server/storage";
import { DEFAULT_SETTINGS, type SettingKey } from "@/server/settings";
import { EDITABLE_KEYS, LOCALES } from "@/lib/i18n/dictionaries";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import type { ActionState } from "@/components/ui/form-status";

const bad = (message: string, errors?: Record<string, string[] | undefined>): ActionState => ({ ok: false, message, errors });

// ───────────── Clients ─────────────
export async function setCustomerAccountStatus(userId: string, status: "ACTIVE" | "SUSPENDED") {
  const me = await assertStaff("customers.manage");
  const u = await db.user.findFirst({ where: { id: userId, type: "CUSTOMER" } });
  if (!u) return { ok: false, message: "Compte introuvable." };
  await db.user.update({ where: { id: userId }, data: { status, ...(status === "ACTIVE" ? { failedLogins: 0, lockedUntil: null } : {}) } });
  if (status === "SUSPENDED") await revokeAllSessions(userId);
  await audit({ actorId: me.id, action: status === "SUSPENDED" ? "customer.suspended" : "customer.reactivated", entity: "User", entityId: userId });
  revalidatePath("/admin/clients", "layout");
  return { ok: true, message: status === "SUSPENDED" ? "Compte suspendu, sessions fermées." : "Compte réactivé." };
}

// ───────────── Messages de contact ─────────────
export async function setContactStatus(id: string, status: "NEW" | "IN_PROGRESS" | "DONE") {
  const me = await assertStaff("messages.manage");
  await db.contactMessage.update({ where: { id }, data: { status, handledById: me.id } });
  revalidatePath("/admin/messages");
  return { ok: true, message: "Message mis à jour." };
}

// ───────────── Assistance ─────────────
export async function staffReplyTicket(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await assertStaff("messages.manage");
  const id = String(form.get("ticketId") ?? "");
  const body = z.string().trim().min(2).max(5000).safeParse(form.get("message"));
  if (!body.success) return bad("Message trop court.");
  const t = await db.supportTicket.findUnique({ where: { id }, include: { customer: true } });
  if (!t) return bad("Conversation introuvable.");
  await db.$transaction([
    db.ticketMessage.create({ data: { ticketId: id, authorId: me.id, isStaff: true, body: body.data } }),
    db.supportTicket.update({ where: { id }, data: { status: form.get("close") === "on" ? "CLOSED" : "ANSWERED" } }),
  ]);
  await audit({ actorId: me.id, action: "ticket.replied", entity: "SupportTicket", entityId: id });
  if (t.customer.userId) {
    await notifyUser(t.customer.userId, { title: `Réponse de l'assistance — ${t.reference}`, body: t.subject, link: `/espace/assistance/${id}`, email: { templateKey: "ticket_reply", vars: { reference: t.reference, subject: t.subject, ticketId: id } } });
  }
  revalidatePath(`/admin/assistance/${id}`);
  return { ok: true, message: "Réponse envoyée." };
}

export async function setTicketStatus(id: string, status: "OPEN" | "CLOSED") {
  const me = await assertStaff("messages.manage");
  await db.supportTicket.update({ where: { id }, data: { status } });
  await audit({ actorId: me.id, action: `ticket.${status.toLowerCase()}`, entity: "SupportTicket", entityId: id });
  revalidatePath(`/admin/assistance/${id}`);
  return { ok: true, message: status === "CLOSED" ? "Conversation fermée." : "Conversation rouverte." };
}

// ───────────── Contenus (traductions) ─────────────
export async function saveTranslations(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await assertStaff("content.manage");
  const locale = String(form.get("locale"));
  if (!(LOCALES as readonly string[]).includes(locale)) return bad("Langue invalide.");
  const ops = [];
  for (const key of EDITABLE_KEYS) {
    const v = form.get(`k:${key}`);
    if (typeof v !== "string") continue;
    const value = v.trim().slice(0, 2000);
    ops.push(value ? db.translation.upsert({ where: { locale_key: { locale, key } }, update: { value }, create: { locale, key, value } }) : db.translation.deleteMany({ where: { locale, key } }));
  }
  await db.$transaction(ops);
  await audit({ actorId: me.id, action: "content.updated", entity: "Translation", metadata: { locale } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Contenus publiés." };
}

// ───────────── FAQ ─────────────
const faqSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  category: z.string().trim().min(2, "Catégorie requise").max(60),
  question: z.string().trim().min(5, "Question trop courte").max(300),
  answer: z.string().trim().min(5, "Réponse trop courte").max(5000),
  locale: z.enum(LOCALES),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isPublished: z.string().optional(),
});
export async function saveFaq(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await assertStaff("faq.manage");
  const p = faqSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return bad("Vérifiez les champs.", p.error.flatten().fieldErrors);
  const { id, isPublished, ...d } = p.data;
  const data = { ...d, isPublished: isPublished === "on" };
  const row = id ? await db.faq.update({ where: { id }, data }) : await db.faq.create({ data });
  await audit({ actorId: me.id, action: id ? "faq.updated" : "faq.created", entity: "Faq", entityId: row.id });
  revalidatePath("/", "layout");
  return { ok: true, message: "Question enregistrée." };
}
export async function deleteFaq(id: string) {
  const me = await assertStaff("faq.manage");
  await db.faq.delete({ where: { id } });
  await audit({ actorId: me.id, action: "faq.deleted", entity: "Faq", entityId: id });
  revalidatePath("/", "layout");
  return { ok: true, message: "Question supprimée." };
}

// ───────────── Témoignages ─────────────
const testimonialSchema = z
  .object({
    id: z.string().uuid().optional().or(z.literal("")),
    authorName: z.string().trim().min(2).max(80),
    authorRole: z.string().trim().max(120).optional(),
    content: z.string().trim().min(10).max(1500),
    rating: z.coerce.number().int().min(1).max(5).optional().or(z.literal("")),
    consentObtained: z.string().optional(),
    consentDate: z.string().optional(),
    isPublished: z.string().optional(),
    locale: z.enum(LOCALES),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine((d) => d.isPublished !== "on" || (d.consentObtained === "on" && !!d.consentDate), { path: ["isPublished"], message: "Publication impossible sans consentement daté de l'auteur" });
export async function saveTestimonial(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await assertStaff("testimonials.manage");
  const p = testimonialSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return bad("Vérifiez les champs.", p.error.flatten().fieldErrors);
  const { id, consentObtained, consentDate, isPublished, rating, ...d } = p.data;
  const data = { ...d, authorRole: d.authorRole || null, rating: rating === "" || rating === undefined ? null : rating, consentObtained: consentObtained === "on", consentDate: consentDate ? new Date(consentDate) : null, isPublished: isPublished === "on" };
  const row = id ? await db.testimonial.update({ where: { id }, data }) : await db.testimonial.create({ data });
  await audit({ actorId: me.id, action: id ? "testimonial.updated" : "testimonial.created", entity: "Testimonial", entityId: row.id, metadata: { published: data.isPublished, consent: data.consentObtained } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Témoignage enregistré." };
}
export async function deleteTestimonial(id: string) {
  const me = await assertStaff("testimonials.manage");
  await db.testimonial.delete({ where: { id } });
  await audit({ actorId: me.id, action: "testimonial.deleted", entity: "Testimonial", entityId: id });
  revalidatePath("/", "layout");
  return { ok: true, message: "Témoignage supprimé." };
}

// ───────────── Modèles d'emails ─────────────
export async function saveEmailTemplate(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await assertStaff("notifications.manage");
  const p = z.object({ id: z.string().uuid(), subject: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(10000) }).safeParse(Object.fromEntries(form));
  if (!p.success) return bad("Vérifiez les champs.", p.error.flatten().fieldErrors);
  await db.emailTemplate.update({ where: { id: p.data.id }, data: { subject: p.data.subject, body: p.data.body } });
  await audit({ actorId: me.id, action: "email_template.updated", entity: "EmailTemplate", entityId: p.data.id });
  revalidatePath("/admin/notifications");
  return { ok: true, message: "Modèle enregistré." };
}

// ───────────── Administrateurs ─────────────
const staffSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email("Email invalide"),
  roleId: z.string().uuid("Choisissez un rôle"),
  password: z.string().optional(),
});
export async function saveStaff(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await assertStaff("users.manage");
  const p = staffSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return bad("Vérifiez les champs.", p.error.flatten().fieldErrors);
  const d = p.data;
  const role = await db.role.findUnique({ where: { id: d.roleId } });
  if (!role) return bad("Rôle introuvable.");
  if (role.key === "super_admin" && me.roleKey !== "super_admin") return bad("Seul un super administrateur peut attribuer ce rôle.");
  const dup = await db.user.findFirst({ where: { email: d.email, ...(d.id ? { NOT: { id: d.id } } : {}) } });
  if (dup) return bad("Cet email est déjà utilisé.", { email: ["Déjà utilisé"] });
  if (d.id) {
    const target = await db.user.findFirst({ where: { id: d.id, type: "STAFF" }, include: { role: true } });
    if (!target) return bad("Utilisateur introuvable.");
    if (target.role?.key === "super_admin" && me.roleKey !== "super_admin") return bad("Seul un super administrateur peut modifier ce compte.");
    if (target.id === me.id && target.roleId !== d.roleId) return bad("Vous ne pouvez pas modifier votre propre rôle.");
    const data: Record<string, unknown> = { firstName: d.firstName, lastName: d.lastName, email: d.email, roleId: d.roleId };
    if (d.password) {
      const pw = passwordSchema.safeParse(d.password);
      if (!pw.success) return bad("Mot de passe trop faible.", { password: pw.error.flatten().formErrors });
      data.passwordHash = await hashPassword(pw.data);
    }
    await db.user.update({ where: { id: d.id }, data });
    if (d.password || target.roleId !== d.roleId) await revokeAllSessions(d.id);
    await audit({ actorId: me.id, action: "staff.updated", entity: "User", entityId: d.id, metadata: { role: role.key } });
  } else {
    const pw = passwordSchema.safeParse(d.password);
    if (!pw.success) return bad("Mot de passe initial requis (10 caractères, majuscule, minuscule, chiffre).", { password: pw.error.flatten().formErrors });
    const u = await db.user.create({ data: { email: d.email, firstName: d.firstName, lastName: d.lastName, roleId: d.roleId, type: "STAFF", passwordHash: await hashPassword(pw.data) } });
    await audit({ actorId: me.id, action: "staff.created", entity: "User", entityId: u.id, metadata: { role: role.key } });
  }
  revalidatePath("/admin/utilisateurs");
  return { ok: true, message: "Administrateur enregistré." };
}
export async function setStaffStatus(id: string, status: "ACTIVE" | "SUSPENDED") {
  const me = await assertStaff("users.manage");
  if (id === me.id) return { ok: false, message: "Vous ne pouvez pas suspendre votre propre compte." };
  const t = await db.user.findFirst({ where: { id, type: "STAFF" }, include: { role: true } });
  if (!t) return { ok: false, message: "Introuvable." };
  if (t.role?.key === "super_admin" && me.roleKey !== "super_admin") return { ok: false, message: "Action réservée à un super administrateur." };
  if (status === "SUSPENDED" && t.role?.key === "super_admin") {
    const others = await db.user.count({ where: { type: "STAFF", status: "ACTIVE", role: { key: "super_admin" }, NOT: { id } } });
    if (others === 0) return { ok: false, message: "Impossible : c'est le dernier super administrateur actif." };
  }
  await db.user.update({ where: { id }, data: { status } });
  if (status === "SUSPENDED") await revokeAllSessions(id);
  await audit({ actorId: me.id, action: status === "SUSPENDED" ? "staff.suspended" : "staff.reactivated", entity: "User", entityId: id });
  revalidatePath("/admin/utilisateurs");
  return { ok: true, message: status === "SUSPENDED" ? "Compte suspendu." : "Compte réactivé." };
}

export async function saveRolePermissions(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await assertStaff("roles.manage");
  const roleId = String(form.get("roleId"));
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) return bad("Rôle introuvable.");
  if (role.key === "super_admin") return bad("Les permissions du super administrateur ne sont pas modifiables.");
  const keys = ALL_PERMISSIONS.filter((k) => form.get(`p:${k}`) === "on");
  await db.role.update({ where: { id: roleId }, data: { permissions: { set: keys.map((key) => ({ key })) } } });
  await audit({ actorId: me.id, action: "role.permissions_updated", entity: "Role", entityId: roleId, metadata: { permissions: keys } });
  revalidatePath("/admin/utilisateurs");
  return { ok: true, message: `Permissions du rôle « ${role.name} » enregistrées.` };
}

// ───────────── Paramètres ─────────────
const settingSchemas: Partial<Record<SettingKey, z.ZodTypeAny>> = {
  org: z.object({
    name: z.string().trim().min(2).max(80), legalName: z.string().trim().max(160), tagline: z.string().trim().max(160), email: z.string().trim().email().or(z.literal("")),
    phone: z.string().trim().max(40), address: z.string().trim().max(300), hours: z.string().trim().max(200), logoUrl: z.string().trim().max(300),
    social: z.object({ linkedin: z.string().url().or(z.literal("")), facebook: z.string().url().or(z.literal("")), instagram: z.string().url().or(z.literal("")), x: z.string().url().or(z.literal("")) }),
  }),
  locale: z.object({ default: z.enum(LOCALES), enabled: z.array(z.enum(LOCALES)).min(1), currency: z.string().regex(/^[A-Z]{3}$/, "Code ISO à 3 lettres"), numberLocale: z.string().min(2).max(10) }),
  compliance: z
    .object({ licensed: z.boolean(), regulator: z.string().trim().max(160), licenseNumber: z.string().trim().max(80), registrationNumber: z.string().trim().max(160), legalNotice: z.string().max(30000), privacyPolicy: z.string().max(30000), terms: z.string().max(30000) })
    .refine((c) => !c.licensed || (c.regulator.length > 1 && c.licenseNumber.length > 1), { path: ["licenseNumber"], message: "Autorité et numéro d'agrément requis pour activer les décisions" }),
  simulator: z.object({ defaultAmount: z.coerce.number().positive(), defaultDuration: z.coerce.number().int().positive() }),
  publicStats: z.object({ enabled: z.boolean(), minApplications: z.coerce.number().int().min(1) }),
  security: z.object({ maxLoginAttempts: z.coerce.number().int().min(3).max(20), lockMinutes: z.coerce.number().int().min(1).max(1440), sessionDays: z.coerce.number().int().min(1).max(30) }),
  seo: z.object({ title: z.string().trim().min(5).max(120), description: z.string().trim().min(10).max(300), ogImage: z.string().trim().max(300) }),
  about: z.object({ team: z.array(z.object({ name: z.string().trim().max(80), role: z.string().trim().max(120) })).max(24) }),
};

/** Les formulaires de paramètres envoient leur section sous forme JSON (champ `payload`). */
export async function saveSettings(_: ActionState, form: FormData): Promise<ActionState> {
  const me = await assertStaff("settings.manage");
  const key = String(form.get("section")) as SettingKey;
  const schema = settingSchemas[key];
  if (!schema || !(key in DEFAULT_SETTINGS)) return bad("Section inconnue.");
  if (key === "compliance" && me.roleKey !== "super_admin") return bad("La conformité ne peut être modifiée que par un super administrateur.");
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("payload") ?? "{}")); } catch { return bad("Données invalides."); }
  const p = schema.safeParse(raw);
  if (!p.success) {
    const flat = p.error.flatten();
    return bad(flat.formErrors[0] ?? "Vérifiez les champs signalés.", flat.fieldErrors as Record<string, string[]>);
  }
  await db.siteSetting.upsert({ where: { key }, update: { value: p.data }, create: { key, value: p.data } });
  await audit({ actorId: me.id, action: "settings.updated", entity: "SiteSetting", entityId: key, metadata: key === "compliance" ? { licensed: (p.data as { licensed: boolean }).licensed } : undefined });
  revalidatePath("/", "layout");
  return { ok: true, message: "Paramètres enregistrés." };
}

export type MediaState = { ok: boolean; message: string; url?: string } | undefined;
export async function uploadMedia(_: MediaState, form: FormData): Promise<MediaState> {
  const me = await assertStaff("content.manage").catch(() => assertStaff("settings.manage"));
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, message: "Fichier requis." };
  try {
    const info = await inspectUpload(file, ["image/png", "image/jpeg", "image/webp"]);
    const key = await storeMedia(info.buffer, info.ext);
    await db.mediaAsset.create({ data: { storageKey: key, mimeType: info.mime, size: info.size, alt: String(form.get("alt") ?? "") || null } });
    await audit({ actorId: me.id, action: "media.uploaded", entity: "MediaAsset", entityId: key });
    return { ok: true, message: "Image téléversée.", url: `/media/${key}` };
  } catch (e) {
    if (e instanceof UploadError) return { ok: false, message: e.message };
    throw e;
  }
}

// ───────────── Notifications internes ─────────────
export async function markStaffNotificationsRead() {
  const me = await getCurrentUser();
  if (!me || me.type !== "STAFF") return;
  await db.notification.updateMany({ where: { userId: me.id, channel: "IN_APP", readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/admin", "layout");
}
