import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { cancelReasonSchema } from "@/lib/validations";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/inventories/[id]/cancel — Abandon d'un inventaire en cours (aucun effet sur le stock)
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "inventory:validate");
    const companyId = requireCompany(user);
    const { id } = await params;
    const { reason } = parseBody(cancelReasonSchema, await readJson(req));

    const inventory = await prisma.inventory.findFirst({ where: { id, companyId }, select: { id: true, centerId: true, number: true } });
    if (!inventory) throw new ApiError(404, "Inventaire introuvable");
    await requireCenterAccess(user, inventory.centerId);

    const done = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "inventories"
           SET "status" = 'CANCELLED', "cancelledAt" = NOW(), "cancelledById" = ${user.id}::text,
               "notes" = CONCAT_WS(' — ', NULLIF("notes", ''), ${`Annulé : ${reason}`}::text), "updatedAt" = NOW()
         WHERE "id" = ${id} AND "status" = 'IN_PROGRESS'
     RETURNING "id"`;
      if (rows.length === 0) throw new ApiError(409, "Seul un inventaire en cours peut être annulé", "INVENTORY_CLOSED");
      await writeAuditLog(
        {
          eventType: "INVENTORY_CANCELLED",
          companyId,
          centerId: inventory.centerId,
          userId: user.id,
          referenceType: "Inventory",
          referenceId: id,
          result: "SUCCESS",
          reason,
          newValues: { number: inventory.number },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return tx.inventory.findUnique({ where: { id } });
    });
    return NextResponse.json({ success: true, data: done });
  } catch (error) {
    return handleApiError(error, "INVENTORIES");
  }
}
