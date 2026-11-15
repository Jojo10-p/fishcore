import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, isUniqueViolation, requestMeta } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { seedCompanyCatalog } from "@/lib/catalog";
import { getBusinessProfile } from "@/lib/business-profiles";
import { startSession } from "@/lib/session";
import { superAdmin, verifySetupCode } from "@/lib/super-admin";

const password = z
  .string()
  .min(8, "Mot de passe : min. 8 caractères")
  .regex(/[A-Z]/, "Mot de passe : au moins une majuscule")
  .regex(/[0-9]/, "Mot de passe : au moins un chiffre");

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide"),
  code: z.string().min(4).max(40),
  password,
  company: z
    .object({
      tradeName: z.string().trim().min(2, "Nom de l'entreprise requis"),
      ownerName: z.string().trim().min(2, "Nom du responsable requis"),
      phone: z.string().trim().min(8, "Numéro de téléphone invalide"),
      address: z.string().trim().optional(),
      city: z.string().trim().optional(),
      taxId: z.string().trim().optional(),
      tradeRegNumber: z.string().trim().optional(),
    })
    .optional(),
});

// Édition GJH : mêmes réglages qu'avant (huiles et lubrifiants, ticket 80 mm, factures « GJH »)
const BUSINESS = "LUBRICANTS" as const;

// POST /api/auth/setup — Code d'installation + mot de passe (+ l'entreprise, la 1re fois).
// La 1re fois : crée l'entreprise et le super administrateur unique.
// Ensuite : le super administrateur redéfinit son mot de passe avec le même code.
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
    const { email, code, company } = parsed.data;
    const meta = requestMeta(req);
    const admin = await superAdmin();
    if (admin && admin.email !== email) return NextResponse.json({ success: false, error: "Ce code ne concerne pas cette adresse." }, { status: 403 });

    const r = await verifySetupCode(email, code, meta.ipAddress);
    if (r === "locked") return NextResponse.json({ success: false, error: "Trop d'essais. Réessayez dans une heure." }, { status: 429 });
    if (r === "bad") return NextResponse.json({ success: false, error: "Code d'installation incorrect." }, { status: 400 });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    // Mot de passe oublié du super administrateur
    if (admin) {
      const user = await prisma.user.update({
        where: { id: admin.id },
        data: { passwordHash, isActive: true, deactivatedAt: null, loginAttempts: 0, lockedUntil: null },
        select: { id: true, role: true, companyId: true },
      });
      await prisma.authSession.deleteMany({ where: { userId: user.id } });
      await writeAuditLog({ eventType: "PASSWORD_CHANGED", companyId: user.companyId, userId: user.id, result: "SUCCESS", newValues: { via: "code-installation" }, ...meta });
      return startSession(NextResponse.json({ success: true, data: { next: "/dashboard" } }), user, meta);
    }

    if (!company) return NextResponse.json({ success: false, error: "Renseignez les informations de l'entreprise." }, { status: 400 });
    const profile = getBusinessProfile(BUSINESS);
    const [firstName, ...rest] = company.ownerName.split(/\s+/);

    const user = await prisma.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          tradeName: company.tradeName,
          ownerName: company.ownerName,
          phone: company.phone,
          email,
          address: company.address || null,
          city: company.city || null,
          taxId: company.taxId || null,
          tradeRegNumber: company.tradeRegNumber || null,
          country: "BJ",
          currency: "XOF",
          timezone: "Africa/Porto-Novo",
          businessType: BUSINESS,
          invoicePrefix: "GJH",
          invoiceFormat: "TICKET_80",
          appName: "GJH Gestion",
          vatEnabled: profile.tax.vatEnabled,
          defaultTaxRate: profile.tax.defaultTaxRate,
          requiresPickup: profile.pickupByDefault ?? false,
        },
      });
      const data = {
        companyId: c.id,
        passwordHash,
        firstName: firstName || company.ownerName,
        lastName: rest.join(" "),
        phone: company.phone,
        role: "COMPANY_OWNER" as const,
        isSuperAdmin: true,
        isActive: true,
      };
      // Un compte existe peut-être déjà avec cette adresse (inscription employé)
      const u = await tx.user.upsert({ where: { email }, create: { email, ...data }, update: { ...data, deactivatedAt: null }, select: { id: true, role: true, companyId: true } });
      await seedCompanyCatalog(tx, c.id, BUSINESS);
      await writeAuditLog({ eventType: "USER_CREATED", companyId: c.id, userId: u.id, referenceType: "User", referenceId: u.id, result: "SUCCESS", newValues: { email, role: "COMPANY_OWNER", superAdmin: true }, ...meta }, tx);
      return u;
    });
    return startSession(NextResponse.json({ success: true, data: { next: "/onboarding" } }, { status: 201 }), user, meta);
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ success: false, error: "Le super administrateur existe déjà." }, { status: 409 });
    return handleApiError(error, "AUTH/SETUP");
  }
}
