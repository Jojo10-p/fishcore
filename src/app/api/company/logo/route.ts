import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";

// Logo de l'entreprise : préparé dans le navigateur (carré PNG 512, 192 et
// version « adaptative » avec marge), stocké en base, servi par /api/brand/…

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 700 * 1024;

function decodePng(dataUrl: string, label: string, expected: number): Uint8Array<ArrayBuffer> {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new ApiError(400, `${label} : image PNG attendue`, "BAD_IMAGE");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_BYTES) throw new ApiError(400, `${label} : image trop lourde`, "IMAGE_TOO_LARGE");
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new ApiError(400, `${label} : fichier PNG invalide`, "BAD_IMAGE");
  // En-tête IHDR : largeur et hauteur (octets 16-23)
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== expected || h !== expected) throw new ApiError(400, `${label} : ${expected}×${expected} px attendu`, "BAD_IMAGE_SIZE");
  return new Uint8Array(buf);
}

const logoSchema = z.object({
  logo512: z.string().max(1_000_000),
  logo192: z.string().max(400_000),
  maskable512: z.string().max(1_000_000),
});

// POST /api/company/logo — Enregistre (ou remplace) le logo
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "company:edit");
    const companyId = requireCompany(user);
    const body = parseBody(logoSchema, await readJson(req));
    const logo512 = decodePng(body.logo512, "Logo", 512);
    const logo192 = decodePng(body.logo192, "Icône", 192);
    const maskable512 = decodePng(body.maskable512, "Icône adaptative", 512);

    const logoUrl = `/api/brand/${companyId}/logo.png?v=${Date.now().toString(36)}`;
    await prisma.$transaction(async (tx) => {
      await tx.companyBrandAsset.upsert({
        where: { companyId },
        create: { companyId, logo512, logo192, maskable512 },
        update: { logo512, logo192, maskable512 },
      });
      await tx.company.update({ where: { id: companyId }, data: { logoUrl } });
      await writeAuditLog(
        {
          eventType: "COMPANY_SETTINGS_CHANGED",
          companyId,
          userId: user.id,
          referenceType: "Company",
          referenceId: companyId,
          result: "SUCCESS",
          newValues: { logo: "remplacé", bytes: logo512.length },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
    });
    return NextResponse.json({ success: true, data: { logoUrl } });
  } catch (error) {
    return handleApiError(error, "COMPANY_LOGO");
  }
}

// DELETE /api/company/logo — Retire le logo (retour à l'icône par défaut)
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "company:edit");
    const companyId = requireCompany(user);
    await prisma.$transaction(async (tx) => {
      await tx.companyBrandAsset.deleteMany({ where: { companyId } });
      await tx.company.update({ where: { id: companyId }, data: { logoUrl: null } });
      await writeAuditLog(
        {
          eventType: "COMPANY_SETTINGS_CHANGED",
          companyId,
          userId: user.id,
          referenceType: "Company",
          referenceId: companyId,
          result: "SUCCESS",
          newValues: { logo: "retiré" },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
    });
    return NextResponse.json({ success: true, data: { logoUrl: null } });
  } catch (error) {
    return handleApiError(error, "COMPANY_LOGO");
  }
}
