import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { companySchema } from "@/lib/validations";
import bcrypt from "bcryptjs";
import { writeAuditLog } from "@/lib/audit";

// POST /api/auth/register — Inscription d'une nouvelle entreprise
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = companySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Vérifier si l'email est déjà utilisé
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: "Un compte existe déjà avec cet email" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Créer l'entreprise
      const company = await tx.company.create({
        data: {
          tradeName: data.tradeName,
          legalName: data.legalName,
          ownerName: data.ownerName,
          phone: data.phone,
          email: data.email,
          address: data.address,
          city: data.city,
          commune: data.commune,
          country: data.country ?? "BJ",
          poBox: data.poBox,
          taxId: data.taxId,
          tradeRegNumber: data.tradeRegNumber,
          currency: data.currency ?? "XOF",
          timezone: data.timezone ?? "Africa/Porto-Novo",
          invoicePrefix: data.invoicePrefix ?? "FACT",
        },
      });

      // 2. Créer le compte propriétaire
      const user = await tx.user.create({
        data: {
          companyId: company.id,
          email: data.email,
          passwordHash,
          firstName: data.ownerName.split(" ")[0] ?? data.ownerName,
          lastName: data.ownerName.split(" ").slice(1).join(" ") || data.ownerName,
          phone: data.phone,
          role: "COMPANY_OWNER",
        },
      });

      // 3. Créer les unités de mesure par défaut
      await tx.unit.createMany({
        data: [
          { companyId: company.id, name: "Kilogramme", symbol: "kg", isBaseUnit: true },
          { companyId: company.id, name: "Gramme", symbol: "g" },
          { companyId: company.id, name: "Carton", symbol: "carton" },
          { companyId: company.id, name: "Sac", symbol: "sac" },
          { companyId: company.id, name: "Pièce", symbol: "pce" },
        ],
      });

      return { company, user };
    });

    await writeAuditLog({
      eventType: "USER_CREATED",
      companyId: result.company.id,
      userId: result.user.id,
      referenceType: "User",
      referenceId: result.user.id,
      result: "SUCCESS",
      newValues: { email: result.user.email, role: "COMPANY_OWNER" },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          companyId: result.company.id,
          userId: result.user.id,
          message: "Compte créé avec succès. Vous pouvez maintenant vous connecter.",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
