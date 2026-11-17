import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/auth";
import { notifyManagers } from "@/lib/notify";

// ─────────────────────────────────────────────
// Arrivage : « déjà payé » ou « pris à crédit »
// ─────────────────────────────────────────────
// Déjà payé : un règlement fournisseur « payé à l'arrivage » solde la facture
// (achat de marchandises en comptabilité). Pris à crédit : la facture reste due
// jusqu'à son échéance, et la direction reçoit des rappels.

export const receiptPaymentSchema = z
  .object({
    mode: z.enum(["PAID", "CREDIT"]),
    method: z.enum(["CASH", "MOBILE_MONEY", "TRANSFER", "CARD"]).optional(),
    dueDate: z.coerce.date().optional(),
  })
  .refine((p) => p.mode === "CREDIT" || !!p.method, { message: "Indiquez comment la marchandise a été payée", path: ["method"] });

export type ReceiptPayment = z.infer<typeof receiptPaymentSchema>;

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

/**
 * Applique le choix payé / à crédit à la facture fournisseur de l'arrivage
 * (à la validation, ou quand l'arrivage est modifié : le règlement suit le nouveau total).
 */
export async function applyReceiptPayment(
  tx: Tx,
  params: { receiptId: string; companyId: string; userId: string; payment: ReceiptPayment; hasSupplier: boolean }
) {
  const { receiptId, companyId, userId, payment } = params;
  if (payment.mode === "CREDIT" && !params.hasSupplier) {
    throw new ApiError(400, "Pris à crédit : choisissez le fournisseur à qui on doit l'argent", "CREDIT_NEEDS_SUPPLIER");
  }
  await tx.goodsReceipt.update({
    where: { id: receiptId },
    data: { paymentMode: payment.mode, paymentMethod: payment.mode === "PAID" ? payment.method : null },
  });
  const receipt = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, select: { purchaseId: true } });
  if (!receipt.purchaseId) return;
  const purchase = await tx.purchase.findUniqueOrThrow({ where: { id: receipt.purchaseId } });
  const atReceipt = await tx.supplierPayment.findMany({ where: { purchaseId: purchase.id, atReceipt: true } });
  const already = atReceipt.reduce((s, p) => s.add(p.amount), new D(0));
  const otherPaid = new D(purchase.paidAmount).sub(already);

  if (payment.mode === "PAID") {
    const amount = new D(purchase.totalAmount).sub(otherPaid);
    const allocations = [{ purchaseId: purchase.id, amount: amount.toString() }];
    if (atReceipt[0]) {
      await tx.supplierPayment.update({ where: { id: atReceipt[0].id }, data: { amount, method: payment.method!, allocations } });
      if (atReceipt.length > 1) await tx.supplierPayment.deleteMany({ where: { id: { in: atReceipt.slice(1).map((p) => p.id) } } });
    } else if (amount.gt(0)) {
      await tx.supplierPayment.create({
        data: {
          companyId,
          supplierId: purchase.supplierId,
          purchaseId: purchase.id,
          amount,
          method: payment.method!,
          allocations,
          paidById: userId,
          notes: "Payé à l'arrivage de la marchandise",
          atReceipt: true,
        },
      });
    }
    await tx.purchase.update({ where: { id: purchase.id }, data: { paidAmount: otherPaid.add(D.max(amount, 0)) } });
  } else {
    if (atReceipt.length) await tx.supplierPayment.deleteMany({ where: { id: { in: atReceipt.map((p) => p.id) } } });
    // Sans date choisie et sans délai chez ce fournisseur : 7 jours pour payer
    const created = purchase.createdAt.getTime();
    const dueDate = payment.dueDate ?? (!purchase.dueDate || purchase.dueDate.getTime() <= created + 3600_000 ? new Date(created + 7 * 24 * 3600_000) : undefined);
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { paidAmount: otherPaid, ...(dueDate ? { dueDate } : {}), lastReminderAt: null },
    });
  }
}

/** Mode de règlement déjà choisi pour un arrivage (pour le garder à jour quand il est modifié). */
export async function currentReceiptPayment(receiptId: string): Promise<ReceiptPayment | null> {
  const r = await prisma.goodsReceipt.findUnique({ where: { id: receiptId }, select: { paymentMode: true, paymentMethod: true } });
  if (r?.paymentMode !== "PAID" && r?.paymentMode !== "CREDIT") return null;
  const method = r.paymentMethod && ["CASH", "MOBILE_MONEY", "TRANSFER", "CARD"].includes(r.paymentMethod) ? (r.paymentMethod as ReceiptPayment["method"]) : "CASH";
  return { mode: r.paymentMode, ...(r.paymentMode === "PAID" ? { method } : {}) };
}

// ─────────────────────────────────────────────
// Rappels : achats à crédit à régler
// ─────────────────────────────────────────────
const CHECK_EVERY_MS = 6 * 3600_000;
const REMIND_EVERY_MS = 20 * 3600_000;
const SOON_MS = 2 * 24 * 3600_000;

/**
 * Prévient le gérant et la direction des achats à crédit qui arrivent à échéance
 * (dans 2 jours ou moins) ou qui sont en retard. Un rappel par facture et par jour.
 * Appelé quand la cloche se met à jour : pas besoin de tâche planifiée.
 */
export async function remindSupplierDues(companyId: string, now = new Date()): Promise<number> {
  // Une vérification toutes les 6 heures au plus par entreprise
  const claimed = await prisma.company.updateMany({
    where: { id: companyId, OR: [{ dueRemindersAt: null }, { dueRemindersAt: { lt: new Date(now.getTime() - CHECK_EVERY_MS) } }] },
    data: { dueRemindersAt: now },
  });
  if (claimed.count === 0) return 0;

  const due = await prisma.purchase.findMany({
    where: {
      companyId,
      dueDate: { lte: new Date(now.getTime() + SOON_MS) },
      receipts: { some: { paymentMode: "CREDIT" } },
      OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: new Date(now.getTime() - REMIND_EVERY_MS) } }],
    },
    include: { supplier: { select: { name: true } }, receipts: { select: { receivedAt: true }, take: 1 } },
  });
  let sent = 0;
  for (const p of due) {
    const left = Number(p.totalAmount) - Number(p.paidAmount);
    if (left <= 0) continue;
    const days = Math.round((p.dueDate!.getTime() - now.getTime()) / (24 * 3600_000));
    const when = days < 0 ? `en retard de ${-days} jour${days < -1 ? "s" : ""}` : days === 0 ? "à régler aujourd'hui" : days === 1 ? "à régler demain" : `à régler dans ${days} jours`;
    const bought = p.receipts[0]?.receivedAt ? ` (marchandise du ${p.receipts[0].receivedAt.toLocaleDateString("fr-FR")})` : "";
    notifyManagers({
      companyId,
      centerId: p.centerId,
      type: "SUPPLIER_DUE",
      title: `💳 ${p.supplier.name} — ${left.toLocaleString("fr-FR")} F ${when}`,
      message: `Achat pris à crédit${bought}${p.reference ? `, réf. ${p.reference}` : ""}. Reste à payer : ${left.toLocaleString("fr-FR")} F. Échéance : ${p.dueDate!.toLocaleDateString("fr-FR")}.`,
      link: "/fournisseurs",
      data: { purchaseId: p.id, supplier: p.supplier.name, left, dueDate: p.dueDate },
    });
    await prisma.purchase.update({ where: { id: p.id }, data: { lastReminderAt: now } });
    sent++;
  }
  return sent;
}
