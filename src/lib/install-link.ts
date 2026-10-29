import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

const INSTALL_SECRET = new TextEncoder().encode(
  process.env.INSTALL_LINK_SECRET ?? "fallback-dev-secret-change-in-prod"
);

export interface InstallTokenPayload {
  companyId: string;
  centerId: string;
  linkId: string;
  exp: number;
}

/**
 * Génère un lien d'installation unique pour une agence.
 * Le lien est signé (JWT) et à usage unique.
 */
export async function generateInstallLink(
  companyId: string,
  centerId: string,
  createdById: string,
  expiresInHours: number = 72
): Promise<string> {
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  // Créer l'entrée en base
  const link = await prisma.agencyInstallLink.create({
    data: {
      companyId,
      centerId,
      expiresAt,
      createdById,
      token: "pending", // temporaire
    },
  });

  // Générer le token JWT signé avec l'ID du lien
  const token = await new SignJWT({
    companyId,
    centerId,
    linkId: link.id,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setIssuedAt()
    .sign(INSTALL_SECRET);

  // Mettre à jour l'entrée avec le vrai token
  await prisma.agencyInstallLink.update({
    where: { id: link.id },
    data: { token },
  });

  await writeAuditLog({
    eventType: "INSTALL_LINK_GENERATED",
    companyId,
    centerId,
    userId: createdById,
    referenceType: "AgencyInstallLink",
    referenceId: link.id,
    result: "SUCCESS",
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${appUrl}/install?token=${token}`;
}

/**
 * Valide un lien d'installation et retourne les données de configuration
 * nécessaires à l'agence.
 */
export async function validateInstallLink(token: string): Promise<{
  valid: boolean;
  error?: string;
  companyId?: string;
  centerId?: string;
  company?: {
    tradeName: string;
    logoUrl: string | null;
    currency: string;
    timezone: string;
  };
  center?: {
    name: string;
    code: string;
    address: string | null;
  };
}> {
  try {
    // Vérifier la signature JWT
    const { payload } = await jwtVerify(token, INSTALL_SECRET);
    const { companyId, centerId, linkId } = payload as unknown as InstallTokenPayload;

    // Vérifier en base que le lien n'a pas été utilisé
    const link = await prisma.agencyInstallLink.findUnique({
      where: { token },
      include: {
        company: {
          select: {
            tradeName: true,
            logoUrl: true,
            currency: true,
            timezone: true,
          },
        },
        center: {
          select: { name: true, code: true, address: true },
        },
      },
    });

    if (!link) return { valid: false, error: "Lien introuvable" };
    if (link.isUsed) return { valid: false, error: "Ce lien a déjà été utilisé" };
    if (new Date() > link.expiresAt) return { valid: false, error: "Lien expiré" };

    return {
      valid: true,
      companyId,
      centerId,
      company: link.company,
      center: link.center,
    };
  } catch {
    return { valid: false, error: "Lien invalide ou corrompu" };
  }
}

/**
 * Marque un lien comme utilisé (usage unique).
 */
export async function markInstallLinkUsed(token: string): Promise<void> {
  const link = await prisma.agencyInstallLink.findUnique({ where: { token } });
  if (!link) return;

  await prisma.agencyInstallLink.update({
    where: { token },
    data: { isUsed: true, usedAt: new Date() },
  });

  await writeAuditLog({
    eventType: "INSTALL_LINK_USED",
    companyId: link.companyId,
    centerId: link.centerId,
    referenceType: "AgencyInstallLink",
    referenceId: link.id,
    result: "SUCCESS",
  });
}
