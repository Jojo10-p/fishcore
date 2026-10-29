import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
  resolveCenterScope,
} from "@/lib/auth";
import { priceLines } from "@/lib/sales";
import { quoteSchema } from "@/lib/validations";
import { generateSaleNumber } from "@/lib/utils";
import { dayBounds, todayIn } from "@/lib/time";

// ─────────────────────────────────────────────
// Devis (cahier §13) : prix de la base au jour du devis, remises autorisées
// seulement aux rôles habilités, validité limitée. Le devis ne réserve pas de
// stock : la disponibilité est vérifiée quand il est encaissé à la caisse.
// ─────────────────────────────────────────────

// GET /api/quotes?search=…&status=OPEN|CONVERTED|CANCELLED|EXPIRED&number=DEV-000001&centerId=…
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "quote:view");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const centerScope = await resolveCenterScope(user, sp.get("centerId"));
    const search = sp.get("search")?.trim();
    const number = sp.get("number")?.trim();
    const status = sp.get("status");
    const now = new Date();

    const where: Prisma.QuoteWhereInput = {
      companyId,
      ...(centerScope ? { centerId: centerScope } : {}),
      ...(number ? { number: { equals: number, mode: "insensitive" } } : {}),
      ...(search
        ? { OR: [{ number: { contains: search, mode: "insensitive" } }, { customer: { name: { contains: search, mode: "insensitive" } } }] }
        : {}),
      ...(status === "OPEN" ? { status: "OPEN", validUntil: { gte: now } } : {}),
      ...(status === "EXPIRED" ? { status: "OPEN", validUntil: { lt: now } } : {}),
      ...(status === "CONVERTED" || status === "CANCELLED" ? { status } : {}),
    };

    const quotes = await prisma.quote.findMany({
      where,
      select: {
        id: true,
        number: true,
        createdAt: true,
        validUntil: true,
        status: true,
        totalAmount: true,
        centerId: true,
        customer: { select: { id: true, name: true, phone: true } },
        sale: { select: { id: true, saleNumber: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({
      success: true,
      data: quotes.map((q) => ({ ...q, expired: q.status === "OPEN" && q.validUntil < now })),
    });
  } catch (error) {
    return handleApiError(error, "QUOTES");
  }
}

// POST /api/quotes — Établir un devis
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "quote:create");
    const companyId = requireCompany(user);
    const data = parseBody(quoteSchema, await readJson(req));
    await requireCenterAccess(user, data.centerId);

    const customer = await prisma.customer.findFirst({ where: { id: data.customerId, companyId }, select: { id: true } });
    if (!customer) throw new ApiError(400, "Client introuvable");
    if (data.lines.some((l) => (l.discount ?? 0) > 0)) await requirePermission(user, "sale:discount");

    // Prix et unités de la base (le prix saisi à l'écran n'est pas repris)
    const pricing = await priceLines(companyId, data.lines, false);
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true, quoteValidityDays: true },
    });
    const tz = company.timezone || "Africa/Porto-Novo";
    const days = data.validityDays ?? company.quoteValidityDays;
    const today = todayIn(tz);
    const lastDay = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + days)).toISOString().slice(0, 10);
    const validUntil = dayBounds(lastDay, tz).end; // valable jusqu'au soir du dernier jour

    const quote = await prisma.$transaction(async (tx) => {
      const counter = await tx.company.update({
        where: { id: companyId },
        data: { quoteCounter: { increment: 1 } },
        select: { quotePrefix: true, quoteCounter: true },
      });
      const number = generateSaleNumber(counter.quotePrefix, counter.quoteCounter - 1);
      const created = await tx.quote.create({
        data: {
          companyId,
          centerId: data.centerId,
          number,
          customerId: data.customerId,
          createdById: user.id,
          validUntil,
          subtotal: pricing.subtotal,
          discountAmount: pricing.discountAmount,
          totalAmount: pricing.totalAmount,
          taxAmount: pricing.taxAmount,
          notes: data.notes || null,
          lines: {
            create: pricing.lines.map((l, i) => ({
              position: i,
              productId: l.productId,
              unitId: l.unitId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discount: l.discount,
              lineTotal: l.lineTotal,
              taxRate: l.taxRate,
              taxAmount: l.taxAmount,
            })),
          },
        },
        select: { id: true, number: true, totalAmount: true, validUntil: true },
      });
      await writeAuditLog(
        {
          eventType: "QUOTE_CREATED",
          companyId,
          centerId: data.centerId,
          userId: user.id,
          referenceType: "Quote",
          referenceId: created.id,
          result: "SUCCESS",
          newValues: { number, total: pricing.totalAmount.toString(), customerId: data.customerId },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return created;
    });

    return NextResponse.json({ success: true, data: quote }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "QUOTES");
  }
}
