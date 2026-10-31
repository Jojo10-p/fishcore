"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { DOCUMENT_TYPES } from "@/lib/status";
import { requireCustomer, revokeAllSessions } from "@/server/auth/session";
import { hashPassword, passwordSchema, verifyPassword } from "@/server/auth/password";
import { inspectUpload, storePrivate, UploadError, deletePrivate } from "@/server/storage";
import { rateLimit } from "@/server/rate-limit";
import { audit } from "@/server/audit";
import { notifyStaff } from "@/server/notify";
import type { ActionState } from "@/components/ui/form-status";

export async function uploadCustomerDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireCustomer();
  if (!(await rateLimit(`upload:${user.id}`, 30, 3600))) return { ok: false, message: "Trop de fichiers envoyés. Réessayez plus tard." };
  const parsed = z
    .object({ applicationId: z.string().uuid().optional().or(z.literal("")), requestId: z.string().uuid().optional().or(z.literal("")), type: z.string().refine((t) => t in DOCUMENT_TYPES, "Type invalide") })
    .safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return { ok: false, message: "Choisissez le type de document.", errors: parsed.error.flatten().fieldErrors };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Sélectionnez un fichier.", errors: { file: ["Fichier requis"] } };

  const { applicationId, requestId, type } = parsed.data;
  let appId: string | null = applicationId || null;
  let reqId: string | null = null;
  if (requestId) {
    const req = await db.documentRequest.findFirst({ where: { id: requestId, application: { customerId: user.customer.id } } });
    if (!req) return { ok: false, message: "Demande de pièce introuvable." };
    reqId = req.id;
    appId = req.applicationId;
  }
  if (appId) {
    const app = await db.loanApplication.findFirst({ where: { id: appId, customerId: user.customer.id, deletedAt: null } });
    if (!app) return { ok: false, message: "Dossier introuvable." };
    if (app.status === "CLOSED") return { ok: false, message: "Ce dossier est clôturé." };
  }

  let stored: { key: string; sha256: string } | null = null;
  try {
    const info = await inspectUpload(file);
    stored = await storePrivate(info.buffer, info.ext);
    const doc = await db.applicationDocument.create({
      data: { customerId: user.customer.id, applicationId: appId, requestId: reqId, type, originalName: info.originalName, storageKey: stored.key, mimeType: info.mime, size: info.size, sha256: stored.sha256, uploadedById: user.id },
    });
    if (reqId) await db.documentRequest.update({ where: { id: reqId }, data: { fulfilledAt: new Date() } });
    await audit({ actorId: user.id, action: "document.uploaded", entity: "ApplicationDocument", entityId: doc.id, metadata: { applicationId: appId, type } });
    if (appId) {
      const app = await db.loanApplication.findUnique({ where: { id: appId } });
      await notifyStaff("documents.review", { title: `Nouveau document — ${app?.reference}`, body: `${user.firstName} ${user.lastName} a transmis : ${DOCUMENT_TYPES[type]}`, link: `/admin/demandes/${appId}` });
    }
  } catch (e) {
    if (stored) await deletePrivate(stored.key);
    if (e instanceof UploadError) return { ok: false, message: e.message, errors: { file: [e.message] } };
    throw e;
  }
  revalidatePath("/espace", "layout");
  return { ok: true, message: "Document transmis. Il sera vérifié par un analyste." };
}

export async function deleteCustomerDocument(id: string) {
  const user = await requireCustomer();
  const doc = await db.applicationDocument.findFirst({ where: { id, customerId: user.customer.id, deletedAt: null } });
  if (!doc || doc.status !== "PENDING") return { ok: false, message: "Ce document ne peut plus être retiré." };
  await db.applicationDocument.update({ where: { id }, data: { deletedAt: new Date() } });
  if (doc.requestId) await db.documentRequest.update({ where: { id: doc.requestId }, data: { fulfilledAt: null } });
  await audit({ actorId: user.id, action: "document.deleted", entity: "ApplicationDocument", entityId: id });
  revalidatePath("/espace", "layout");
  return { ok: true, message: "Document retiré." };
}

const profileSchema = z.object({
  firstName: z.string().trim().min(2).max(120),
  lastName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6, "Téléphone invalide").max(30).regex(/^[+0-9 ().-]+$/, "Téléphone invalide"),
  country: z.string().trim().max(80),
  city: z.string().trim().max(80),
  address: z.string().trim().max(250),
  profession: z.string().trim().max(120).optional(),
  employer: z.string().trim().max(150).optional(),
});

export async function updateProfile(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireCustomer();
  const parsed = profileSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Vérifiez les champs.", errors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { firstName: d.firstName, lastName: d.lastName, phone: d.phone } }),
    db.customer.update({ where: { id: user.customer.id }, data: { ...d, profession: d.profession || null, employer: d.employer || null } }),
  ]);
  await audit({ actorId: user.id, action: "profile.updated", entity: "Customer", entityId: user.customer.id });
  revalidatePath("/espace", "layout");
  return { ok: true, message: "Profil mis à jour." };
}

export async function changePassword(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireCustomer();
  const current = String(form.get("currentPassword") ?? "");
  const pw = passwordSchema.safeParse(form.get("newPassword"));
  if (!pw.success) return { ok: false, message: "Nouveau mot de passe invalide.", errors: { newPassword: pw.error.flatten().formErrors } };
  if (form.get("newPassword") !== form.get("confirmPassword")) return { ok: false, message: "Les mots de passe ne correspondent pas.", errors: { confirmPassword: ["Les mots de passe ne correspondent pas"] } };
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(current, u.passwordHash))) return { ok: false, message: "Mot de passe actuel incorrect.", errors: { currentPassword: ["Incorrect"] } };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw.data) } });
  await revokeAllSessions(user.id, user.sessionId);
  await audit({ actorId: user.id, action: "auth.password_changed", entity: "User", entityId: user.id });
  return { ok: true, message: "Mot de passe modifié. Vos autres sessions ont été déconnectées." };
}

export async function updateNotificationPrefs(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireCustomer();
  await db.user.update({ where: { id: user.id }, data: { notifyByEmail: form.get("notifyByEmail") === "on", notifyInApp: form.get("notifyInApp") === "on" } });
  revalidatePath("/espace/profil");
  return { ok: true, message: "Préférences enregistrées." };
}

export async function markNotificationsRead() {
  const user = await requireCustomer();
  await db.notification.updateMany({ where: { userId: user.id, channel: "IN_APP", readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/espace", "layout");
}

const ticketSchema = z.object({
  subject: z.string().trim().min(4, "Sujet trop court").max(150),
  message: z.string().trim().min(10, "Message trop court").max(5000),
  applicationId: z.string().uuid().optional().or(z.literal("")),
});

export async function createTicket(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireCustomer();
  const parsed = ticketSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Vérifiez les champs.", errors: parsed.error.flatten().fieldErrors };
  if (!(await rateLimit(`ticket:${user.id}`, 10, 3600))) return { ok: false, message: "Trop de demandes. Réessayez plus tard." };
  const { subject, message, applicationId } = parsed.data;
  if (applicationId && !(await db.loanApplication.findFirst({ where: { id: applicationId, customerId: user.customer.id } }))) return { ok: false, message: "Dossier introuvable." };
  const reference = `AS-${randomBytes(4).toString("hex").toUpperCase()}`;
  const ticket = await db.supportTicket.create({
    data: { reference, subject, customerId: user.customer.id, applicationId: applicationId || null, messages: { create: { authorId: user.id, body: message } } },
  });
  await notifyStaff("messages.manage", { title: `Assistance ${reference}`, body: `${user.firstName} ${user.lastName} : ${subject}`, link: `/admin/assistance/${ticket.id}` });
  redirect(`/espace/assistance/${ticket.id}`);
}

export async function replyTicket(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireCustomer();
  const id = String(form.get("ticketId") ?? "");
  const body = z.string().trim().min(2, "Message trop court").max(5000).safeParse(form.get("message"));
  if (!body.success) return { ok: false, message: "Message trop court.", errors: { message: body.error.flatten().formErrors } };
  const ticket = await db.supportTicket.findFirst({ where: { id, customerId: user.customer.id } });
  if (!ticket) return { ok: false, message: "Conversation introuvable." };
  if (!(await rateLimit(`ticket-msg:${user.id}`, 40, 3600))) return { ok: false, message: "Trop de messages. Réessayez plus tard." };
  await db.$transaction([
    db.ticketMessage.create({ data: { ticketId: id, authorId: user.id, body: body.data } }),
    db.supportTicket.update({ where: { id }, data: { status: "OPEN" } }),
  ]);
  await notifyStaff("messages.manage", { title: `Nouveau message — ${ticket.reference}`, body: ticket.subject, link: `/admin/assistance/${id}` });
  revalidatePath(`/espace/assistance/${id}`);
  return { ok: true, message: "" };
}
