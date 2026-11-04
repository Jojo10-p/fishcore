import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCompany } from "@/lib/auth";
import { PUSH_ROLES, pushConfigured, sendPush } from "@/lib/push";
import { LOW_STOCK_THRESHOLD } from "@/lib/app-config";

// POST /api/push/test — notification d'essai sur les appareils de ce compte
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    requireCompany(user);
    if (!(PUSH_ROLES as string[]).includes(user.role)) throw new ApiError(403, "Réservé au gérant et au patron", "FORBIDDEN");
    if (!pushConfigured()) throw new ApiError(503, "Notifications non configurées sur le serveur", "PUSH_NOT_CONFIGURED");
    const devices = await prisma.pushSubscription.findMany({ where: { userId: user.id }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
    if (!devices.length) throw new ApiError(404, "Aucun appareil abonné", "NO_DEVICE");
    const sent = await sendPush(devices, {
      title: "Notifications activées",
      body: `Vous serez prévenu quand un article descend à ${LOW_STOCK_THRESHOLD}, puis à chaque vente.`,
      tag: "test",
      url: "/dashboard",
      requireAck: true,
    });
    return NextResponse.json({ success: true, data: { sent } });
  } catch (error) {
    return handleApiError(error, "PUSH");
  }
}
