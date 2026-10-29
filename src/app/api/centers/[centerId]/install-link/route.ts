import { NextRequest, NextResponse } from "next/server";
import { generateInstallLink } from "@/lib/install-link";
import { generateInstallLinkSchema } from "@/lib/validations";
import {
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requirePermission,
} from "@/lib/auth";

const bodySchema = generateInstallLinkSchema.pick({ expiresInHours: true });

// POST /api/centers/[centerId]/install-link — Générer un lien d'installation (usage unique)
export async function POST(req: NextRequest, { params }: { params: Promise<{ centerId: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "install_link:generate");
    const { centerId } = await params;
    const center = await requireCenterAccess(user, centerId);
    const { expiresInHours } = parseBody(bodySchema, await readJson(req));

    const link = await generateInstallLink(center.companyId, center.id, user.id, expiresInHours);

    return NextResponse.json({
      success: true,
      data: {
        installLink: link,
        expiresInHours,
        message: `Lien valide ${expiresInHours} heures. Usage unique.`,
      },
    });
  } catch (error) {
    return handleApiError(error, "INSTALL_LINK");
  }
}
