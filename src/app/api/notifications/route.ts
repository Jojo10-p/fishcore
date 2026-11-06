import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, parseBody, readJson, requireCompany } from "@/lib/auth";

// GET /api/notifications — Ma cloche : les plus récentes d'abord (?before=<date> pour remonter)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const companyId = requireCompany(user);
    const { searchParams } = new URL(req.url);
    const before = searchParams.get("before");
    const take = Math.min(Number(searchParams.get("take")) || 30, 100);
    const where = { companyId, userId: user.id };
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { ...where, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, createdAt: true, type: true, title: true, message: true, data: true, isRead: true },
      }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);
    return NextResponse.json({ success: true, data: { items, unread } });
  } catch (error) {
    return handleApiError(error, "NOTIFICATIONS");
  }
}

const readSchema = z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() });

// POST /api/notifications — « Vu » : marque comme lues (rien n'est effacé)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const companyId = requireCompany(user);
    const { ids, all } = parseBody(readSchema, await readJson(req));
    const r = await prisma.notification.updateMany({
      where: { companyId, userId: user.id, isRead: false, ...(all ? {} : { id: { in: ids ?? [] } }) },
      data: { isRead: true, readAt: new Date() },
    });
    return NextResponse.json({ success: true, data: { updated: r.count } });
  } catch (error) {
    return handleApiError(error, "NOTIFICATIONS");
  }
}
