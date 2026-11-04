import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCompany } from "@/lib/auth";
import { PUSH_ROLES, pushConfigured, vapidPublicKey } from "@/lib/push";

// Notifications sur téléphone pour le gérant et le patron.

const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(5).max(100) }),
});

function allowed(role: string) {
  return (PUSH_ROLES as string[]).includes(role);
}

// GET /api/push — clé publique et appareils déjà abonnés pour ce compte
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    requireCompany(user);
    const devices = allowed(user.role) ? await prisma.pushSubscription.count({ where: { userId: user.id } }) : 0;
    return NextResponse.json({ success: true, data: { allowed: allowed(user.role), configured: pushConfigured(), publicKey: vapidPublicKey(), devices } });
  } catch (error) {
    return handleApiError(error, "PUSH");
  }
}

// POST /api/push — abonner cet appareil
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const companyId = requireCompany(user);
    if (!allowed(user.role)) throw new ApiError(403, "Les alertes de stock sont réservées au gérant et au patron", "FORBIDDEN");
    const parsed = subSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new ApiError(400, "Abonnement invalide", "VALIDATION");
    const { endpoint, keys } = parsed.data;
    const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId: user.id, companyId, userAgent },
      update: { p256dh: keys.p256dh, auth: keys.auth, userId: user.id, companyId, userAgent },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "PUSH");
  }
}

// DELETE /api/push — désabonner cet appareil
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
    if (body.endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "PUSH");
  }
}
