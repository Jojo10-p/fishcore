import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInstallLink, markInstallLinkUsed } from "@/lib/install-link";

// GET /api/install?token=xxx — Valider un lien d'installation et retourner la config
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { success: false, error: "Token d'installation manquant" },
        { status: 400 }
      );
    }

    const result = await validateInstallLink(token);
    if (!result.valid) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Récupérer la configuration complète pour l'agence
    const center = await prisma.center.findUnique({
      where: { id: result.centerId },
      include: {
        company: {
          select: {
            id: true,
            tradeName: true,
            logoUrl: true,
            currency: true,
            timezone: true,
            invoicePrefix: true,
          },
        },
        cashRegisters: {
          where: { isActive: true },
          select: { id: true, name: true },
        },
      },
    });

    if (!center) {
      return NextResponse.json(
        { success: false, error: "Centre introuvable" },
        { status: 404 }
      );
    }

    // Config que l'agence va stocker localement
    const agencyConfig = {
      companyId: center.companyId,
      centerId: center.id,
      centerName: center.name,
      centerCode: center.code,
      companyName: center.company.tradeName,
      logoUrl: center.company.logoUrl,
      currency: center.company.currency,
      timezone: center.company.timezone,
      invoicePrefix: center.company.invoicePrefix,
      cashRegisters: center.cashRegisters,
      installedAt: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data: agencyConfig });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Erreur serveur" },
      { status: 500 }
    );
  }
}

// POST /api/install — Confirmer l'utilisation du lien (marquer comme utilisé)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, deviceId } = body;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Token requis" },
        { status: 400 }
      );
    }

    const result = await validateInstallLink(token);
    if (!result.valid) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    await markInstallLinkUsed(token);

    return NextResponse.json({
      success: true,
      message: "Installation confirmée. L'agence est maintenant configurée.",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Erreur serveur" },
      { status: 500 }
    );
  }
}
