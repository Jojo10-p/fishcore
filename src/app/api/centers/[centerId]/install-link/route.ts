import { NextRequest, NextResponse } from "next/server";
import { generateInstallLink } from "@/lib/install-link";
import { generateInstallLinkSchema } from "@/lib/validations";

// POST /api/centers/[centerId]/install-link — Générer un lien d'installation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ centerId: string }> }
) {
  try {
    const { centerId } = await params;
    const body = await req.json();

    const parsed = generateInstallLinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { companyId, createdById } = body;
    if (!companyId || !createdById) {
      return NextResponse.json(
        { success: false, error: "companyId et createdById requis" },
        { status: 400 }
      );
    }

    const link = await generateInstallLink(
      companyId,
      centerId,
      createdById,
      parsed.data.expiresInHours
    );

    return NextResponse.json({
      success: true,
      data: {
        installLink: link,
        expiresInHours: parsed.data.expiresInHours,
        message: `Lien valide ${parsed.data.expiresInHours} heures. Usage unique.`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
