import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import crypto from "crypto";
import { Prisma, UserRole } from "@prisma/client";
import { ZodError, type ZodType } from "zod";
import { prisma } from "@/lib/prisma";
import { hasPermission, type Permission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { getJwtSecret, SESSION_COOKIE } from "@/lib/secrets";

// ─────────────────────────────────────────────
// Authentification & contrôle d'accès côté serveur (cahier §5, §18)
// ─────────────────────────────────────────────
// Règle d'or : l'identité, l'entreprise et les centres d'un utilisateur
// viennent UNIQUEMENT de sa session vérifiée — jamais du corps de la requête
// ni des paramètres d'URL.

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  companyId: string | null;
  /** Centres auxquels l'utilisateur est affecté (relu en base à chaque requête). */
  centerIds: string[];
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

/** Empreinte stockée en base à la place du jeton brut. */
export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function requestMeta(req: NextRequest) {
  return {
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
}

/**
 * Retourne l'utilisateur authentifié, ou lève une ApiError 401.
 * Vérifie : signature du JWT, session en base (révocable), compte actif,
 * entreprise active. Les centres sont relus en base (un retrait de droits
 * prend effet immédiatement, sans attendre l'expiration du jeton).
 */
export async function getCurrentUser(req: NextRequest): Promise<AuthUser> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError(401, "Non authentifié");

  try {
    await jwtVerify(token, getJwtSecret());
  } catch {
    throw new ApiError(401, "Session expirée");
  }

  const session = await prisma.authSession.findUnique({
    where: { sessionToken: hashSessionToken(token) },
    select: {
      id: true,
      expires: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          companyId: true,
          company: { select: { isActive: true } },
          centers: {
            where: { isActive: true, center: { status: "ACTIVE" } },
            select: { centerId: true },
          },
        },
      },
    },
  });

  if (!session || session.expires < new Date()) {
    throw new ApiError(401, "Session expirée");
  }
  const { user } = session;
  if (!user.isActive) throw new ApiError(401, "Compte désactivé");
  if (user.company && !user.company.isActive) {
    throw new ApiError(403, "L'abonnement de cette entreprise est suspendu.");
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    companyId: user.companyId,
    centerIds: user.centers.map((c) => c.centerId),
    sessionId: session.id,
    ...requestMeta(req),
  };
}

/** Historise un refus d'accès (cahier §26.4 : refusé ET historisé). */
async function logDenied(user: AuthUser, reason: string, metadata?: Record<string, unknown>) {
  await writeAuditLog({
    eventType: "UNAUTHORIZED_ACCESS_ATTEMPT",
    companyId: user.companyId,
    userId: user.id,
    result: "DENIED",
    reason,
    metadata,
    ipAddress: user.ipAddress,
    userAgent: user.userAgent,
  });
}

/** Lève une 403 (et l'historise) si le rôle n'a pas la permission. */
export async function requirePermission(user: AuthUser, permission: Permission): Promise<void> {
  if (!hasPermission(user.role, permission)) {
    await logDenied(user, `Permission manquante : ${permission}`, { permission });
    throw new ApiError(403, "Action non autorisée pour votre rôle", "FORBIDDEN");
  }
}

/** Retourne l'entreprise de l'utilisateur (403 si compte plateforme). */
export function requireCompany(user: AuthUser): string {
  if (!user.companyId) {
    throw new ApiError(403, "Ce compte n'est rattaché à aucune entreprise", "NO_COMPANY");
  }
  return user.companyId;
}

/** Le propriétaire voit tous les centres de son entreprise ; les autres, leurs centres affectés. */
export function hasCompanyWideAccess(user: AuthUser): boolean {
  return user.role === "COMPANY_OWNER";
}

/**
 * Vérifie que le centre existe, appartient à l'entreprise de l'utilisateur
 * et lui est accessible. Lève 404 (pour ne pas révéler l'existence d'un
 * centre d'une autre entreprise) ou 403.
 */
export async function requireCenterAccess(user: AuthUser, centerId: string): Promise<{ id: string; companyId: string }> {
  const companyId = requireCompany(user);
  const center = await prisma.center.findFirst({
    where: { id: centerId, companyId },
    select: { id: true, companyId: true },
  });
  if (!center) {
    await logDenied(user, "Accès à un centre inexistant ou d'une autre entreprise", { centerId });
    throw new ApiError(404, "Centre introuvable");
  }
  if (!hasCompanyWideAccess(user) && !user.centerIds.includes(centerId)) {
    await logDenied(user, "Accès à un centre non affecté", { centerId });
    throw new ApiError(403, "Vous n'avez pas accès à ce centre", "FORBIDDEN");
  }
  return center;
}

/**
 * Filtre Prisma « centres visibles par l'utilisateur », à appliquer sur
 * tout champ `centerId` dans les requêtes de liste.
 */
export function visibleCenterFilter(user: AuthUser): Prisma.StringFilter | undefined {
  if (hasCompanyWideAccess(user)) return undefined; // déjà limité par companyId
  return { in: user.centerIds };
}

/**
 * Restreint une liste au centre demandé (s'il est accessible) ou à tous les
 * centres visibles. À utiliser avec `companyId` dans le where.
 */
export async function resolveCenterScope(
  user: AuthUser,
  requestedCenterId: string | null | undefined
): Promise<Prisma.StringFilter | string | undefined> {
  if (requestedCenterId) {
    await requireCenterAccess(user, requestedCenterId);
    return requestedCenterId;
  }
  return visibleCenterFilter(user);
}

/** Valide un corps de requête avec Zod (400 lisible en cas d'erreur). */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Données invalides", "VALIDATION");
  }
  return parsed.data;
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new ApiError(400, "Corps de requête JSON invalide", "BAD_JSON");
  }
}

/** Convertit toute erreur en réponse JSON cohérente, sans fuite d'information interne. */
export function handleApiError(error: unknown, context = "API"): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { success: false, error: error.message, ...(error.code ? { code: error.code } : {}) },
      { status: error.status }
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { success: false, error: error.issues[0]?.message ?? "Données invalides", code: "VALIDATION" },
      { status: 400 }
    );
  }
  console.error(`[${context}]`, error);
  return NextResponse.json({ success: false, error: "Erreur interne du serveur" }, { status: 500 });
}

/** Vrai si l'erreur Prisma est une violation de contrainte d'unicité. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
