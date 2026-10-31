"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStaff } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { notifyUser } from "@/server/notify";
import { getSettings } from "@/server/settings";
import { APPLICATION_STATUS_META, DECISION_STATUSES, DOCUMENT_TYPES } from "@/lib/status";
import type { ActionState } from "@/components/ui/form-status";
import type { ApplicationStatus } from "@/generated/prisma/enums";

const STATUS = z.enum(["NEW", "UNDER_REVIEW", "MISSING_DOCUMENTS", "ON_HOLD", "APPROVED", "REJECTED", "CLOSED"]);

function fail(message: string, errors?: Record<string, string[]>): ActionState {
  return { ok: false, message, errors };
}

export async function changeStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await assertStaff("applications.update");
  const parsed = z
    .object({ id: z.string().uuid(), status: STATUS, publicComment: z.string().trim().max(3000).optional(), decisionReason: z.string().trim().max(3000).optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Données invalides.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const { id, status, publicComment, decisionReason } = parsed.data;
  const app = await db.loanApplication.findFirst({ where: { id, deletedAt: null }, include: { customer: true } });
  if (!app) return fail("Dossier introuvable.");
  if (app.status === status) return fail("Le dossier a déjà ce statut.");

  const isDecision = DECISION_STATUSES.includes(status as ApplicationStatus);
  if (isDecision) {
    const settings = await getSettings();
    if (!settings.compliance.licensed) return fail("Les décisions sont désactivées tant que l'agrément n'est pas renseigné dans les paramètres de conformité.");
    if (!user.can("applications.decide")) return fail("Vous n'êtes pas habilité(e) à prendre une décision.");
    if (!decisionReason || decisionReason.length < 10) return fail("Une justification (10 caractères minimum) est requise pour toute décision.", { decisionReason: ["Justification requise"] });
  }

  await db.$transaction([
    db.loanApplication.update({
      where: { id },
      data: { status, ...(isDecision ? { decisionReason, decidedAt: new Date() } : {}), ...(status === "UNDER_REVIEW" && !app.assignedToId ? { assignedToId: user.id } : {}) },
    }),
    db.applicationStatusHistory.create({ data: { applicationId: id, fromStatus: app.status, toStatus: status, publicComment: publicComment || null, actorId: user.id } }),
  ]);
  await audit({ actorId: user.id, action: "application.status_changed", entity: "LoanApplication", entityId: id, metadata: { from: app.status, to: status } });

  if (app.customer.userId) {
    const label = APPLICATION_STATUS_META[status].label;
    await notifyUser(app.customer.userId, {
      title: `${app.reference} : ${label}`,
      body: publicComment || `Le statut de votre demande est désormais « ${label} ».`,
      link: `/espace/demandes/${id}`,
      email: { templateKey: "status_changed", vars: { reference: app.reference, status: label, comment: publicComment ?? "", applicationId: id } },
    });
  }
  revalidatePath(`/admin/demandes/${id}`);
  return { ok: true, message: `Statut mis à jour : ${APPLICATION_STATUS_META[status].label}.` };
}

export async function addInternalNote(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await assertStaff("applications.update");
  const parsed = z.object({ id: z.string().uuid(), message: z.string().trim().min(2, "Note trop courte").max(5000) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Note invalide.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  await db.internalNote.create({ data: { applicationId: parsed.data.id, authorId: user.id, body: parsed.data.message } });
  await audit({ actorId: user.id, action: "application.note_added", entity: "LoanApplication", entityId: parsed.data.id });
  revalidatePath(`/admin/demandes/${parsed.data.id}`);
  return { ok: true, message: "" };
}

export async function requestDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await assertStaff("applications.update");
  const parsed = z
    .object({ id: z.string().uuid(), type: z.string().refine((t) => t in DOCUMENT_TYPES), label: z.string().trim().max(150).optional(), message: z.string().trim().max(2000).optional(), setStatus: z.string().optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Données invalides.");
  const { id, type, message, setStatus } = parsed.data;
  const label = parsed.data.label || DOCUMENT_TYPES[type];
  const app = await db.loanApplication.findFirst({ where: { id, deletedAt: null }, include: { customer: true } });
  if (!app) return fail("Dossier introuvable.");
  await db.documentRequest.create({ data: { applicationId: id, label, message: message || null } });
  if (setStatus === "on" && app.status !== "MISSING_DOCUMENTS") {
    await db.$transaction([
      db.loanApplication.update({ where: { id }, data: { status: "MISSING_DOCUMENTS" } }),
      db.applicationStatusHistory.create({ data: { applicationId: id, fromStatus: app.status, toStatus: "MISSING_DOCUMENTS", publicComment: `Pièce demandée : ${label}`, actorId: user.id } }),
    ]);
  }
  await audit({ actorId: user.id, action: "application.document_requested", entity: "LoanApplication", entityId: id, metadata: { label } });
  if (app.customer.userId) {
    await notifyUser(app.customer.userId, {
      title: `Pièce demandée — ${app.reference}`,
      body: label,
      link: `/espace/demandes/${id}`,
      email: { templateKey: "documents_requested", vars: { reference: app.reference, label, message: message ?? "", applicationId: id } },
    });
  }
  revalidatePath(`/admin/demandes/${id}`);
  return { ok: true, message: "Demande de pièce envoyée au client." };
}

export async function reviewDocument(docId: string, status: "ACCEPTED" | "REJECTED", note?: string) {
  const user = await assertStaff("documents.review");
  const doc = await db.applicationDocument.findFirst({ where: { id: docId, deletedAt: null }, include: { customer: true, application: true } });
  if (!doc) return { ok: false, message: "Document introuvable." };
  if (status === "REJECTED" && (!note || note.trim().length < 3)) return { ok: false, message: "Indiquez le motif du refus." };
  await db.applicationDocument.update({ where: { id: docId }, data: { status, reviewNote: note?.trim() || null, reviewedById: user.id, reviewedAt: new Date() } });
  if (status === "REJECTED" && doc.applicationId) {
    await db.documentRequest.create({ data: { applicationId: doc.applicationId, label: DOCUMENT_TYPES[doc.type] ?? "Document", message: `Document précédent refusé : ${note}` } });
  }
  await audit({ actorId: user.id, action: `document.${status.toLowerCase()}`, entity: "ApplicationDocument", entityId: docId });
  if (doc.customer.userId) {
    await notifyUser(doc.customer.userId, {
      title: status === "ACCEPTED" ? "Document validé" : "Document à renvoyer",
      body: status === "ACCEPTED" ? `« ${doc.originalName} » a été validé.` : `« ${doc.originalName} » a été refusé : ${note}`,
      link: doc.applicationId ? `/espace/demandes/${doc.applicationId}` : "/espace/documents",
    });
  }
  if (doc.applicationId) revalidatePath(`/admin/demandes/${doc.applicationId}`);
  return { ok: true, message: status === "ACCEPTED" ? "Document validé." : "Document refusé, le client est invité à le renvoyer." };
}

export async function assignApplication(id: string, assigneeId: string | null) {
  const user = await assertStaff("applications.update");
  if (assigneeId) {
    const a = await db.user.findFirst({ where: { id: assigneeId, type: "STAFF", status: "ACTIVE" } });
    if (!a) return { ok: false, message: "Agent introuvable." };
  }
  await db.loanApplication.update({ where: { id }, data: { assignedToId: assigneeId } });
  await audit({ actorId: user.id, action: "application.assigned", entity: "LoanApplication", entityId: id, metadata: { assigneeId } });
  revalidatePath(`/admin/demandes/${id}`);
  return { ok: true, message: "Attribution mise à jour." };
}

export async function cancelDocumentRequest(id: string) {
  const user = await assertStaff("applications.update");
  const r = await db.documentRequest.delete({ where: { id } });
  await audit({ actorId: user.id, action: "application.document_request_cancelled", entity: "LoanApplication", entityId: r.applicationId });
  revalidatePath(`/admin/demandes/${r.applicationId}`);
  return { ok: true, message: "Demande de pièce annulée." };
}
