import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";
import { checkConnection, decryptToken, encryptToken, MecefError, retryPending, TAX_GROUPS, type MecefMode, type MecefStatus } from "@/lib/mecef";

// ─────────────────────────────────────────────
// Réglages de la facture normalisée e-MECeF (direction uniquement)
// ─────────────────────────────────────────────
// Le jeton DGI est enregistré chiffré et n'est jamais renvoyé : on indique
// seulement s'il est présent. L'activation n'est acceptée qu'après un test de
// connexion réussi avec la DGI (jeton valide, IFU reconnu).

const select = {
  taxId: true,
  mecefEnabled: true,
  mecefMode: true,
  mecefTokenEnc: true,
  mecefTaxGroup: true,
  mecefNim: true,
  mecefTokenValid: true,
  mecefCheckedAt: true,
  vatEnabled: true,
} as const;

async function guard(req: NextRequest) {
  const user = await getCurrentUser(req);
  await requirePermission(user, "company:edit");
  if (user.role !== "COMPANY_OWNER") throw new ApiError(403, "Réservé à la direction", "FORBIDDEN");
  return { user, companyId: requireCompany(user) };
}

async function view(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select });
  const [pending, rejected] = await Promise.all([
    prisma.mecefInvoice.count({ where: { companyId, status: "PENDING" } }),
    prisma.mecefInvoice.count({ where: { companyId, status: "ERROR" } }),
  ]);
  return {
    ifu: c.taxId,
    enabled: c.mecefEnabled,
    mode: c.mecefMode,
    hasToken: !!c.mecefTokenEnc,
    taxGroup: c.mecefTaxGroup,
    nim: c.mecefNim,
    tokenValid: c.mecefTokenValid,
    checkedAt: c.mecefCheckedAt,
    vatEnabled: c.vatEnabled,
    pending,
    rejected,
    taxGroups: TAX_GROUPS,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { companyId } = await guard(req);
    return NextResponse.json({ success: true, data: await view(companyId) });
  } catch (error) {
    return handleApiError(error, "MECEF");
  }
}

const schema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["TEST", "PROD"]).optional(),
  // Nouveau jeton (vide = ne pas changer)
  token: z.string().trim().max(4000).optional(),
  taxGroup: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
  // Test de connexion seul, sans rien enregistrer d'autre
  testOnly: z.boolean().optional(),
});

const parseDate = (v?: string) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function PUT(req: NextRequest) {
  try {
    const { user, companyId } = await guard(req);
    const data = parseBody(schema, await readJson(req));
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select });

    const mode: MecefMode = (data.mode ?? before.mecefMode) === "PROD" ? "PROD" : "TEST";
    const token = data.token ? data.token.replace(/^Bearer\s+/i, "") : before.mecefTokenEnc ? decryptToken(before.mecefTokenEnc) : null;
    const enable = data.testOnly ? before.mecefEnabled : data.enabled ?? before.mecefEnabled;
    const mustTest = data.testOnly || (enable && (!!data.token || data.mode !== undefined || !before.mecefEnabled));

    let status: MecefStatus | null = null;
    if (mustTest) {
      if (!token) throw new ApiError(400, "Collez d'abord le jeton fourni par la DGI", "MECEF_NO_TOKEN");
      if (!before.taxId?.trim()) throw new ApiError(400, "Renseignez d'abord l'IFU de l'entreprise (Paramètres → Entreprise)", "MECEF_NO_IFU");
      try {
        status = await checkConnection({ mode, token });
      } catch (e) {
        const msg = e instanceof MecefError ? e.message : "Test impossible";
        throw new ApiError(400, `La DGI n'a pas accepté la connexion : ${msg}`, "MECEF_TEST_FAILED");
      }
      if (status.ifu && status.ifu.trim() !== before.taxId.trim()) {
        throw new ApiError(400, `Ce jeton appartient à l'IFU ${status.ifu}, pas à celui de l'entreprise (${before.taxId})`, "MECEF_IFU_MISMATCH");
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          ...(data.testOnly ? {} : { mecefEnabled: enable, mecefMode: mode }),
          ...(data.token && !data.testOnly ? { mecefTokenEnc: encryptToken(token!) } : {}),
          ...(data.taxGroup && !data.testOnly ? { mecefTaxGroup: data.taxGroup } : {}),
          ...(status ? { mecefNim: status.nim ?? null, mecefTokenValid: parseDate(status.tokenValid), mecefCheckedAt: new Date() } : {}),
        },
      });
      if (!data.testOnly) {
        await writeAuditLog(
          {
            eventType: "COMPANY_SETTINGS_CHANGED",
            companyId,
            userId: user.id,
            referenceType: "Company",
            referenceId: companyId,
            result: "SUCCESS",
            oldValues: { mecefEnabled: before.mecefEnabled, mecefMode: before.mecefMode, mecefTaxGroup: before.mecefTaxGroup },
            // Le jeton n'apparaît jamais dans le journal
            newValues: { mecefEnabled: enable, mecefMode: mode, mecefTaxGroup: data.taxGroup ?? before.mecefTaxGroup, tokenChanged: !!data.token },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
      }
    });

    // Activation : les factures restées en attente repartent
    if (enable && !data.testOnly) await retryPending(companyId, 10);

    return NextResponse.json({ success: true, data: { ...(await view(companyId)), test: status ? { ifu: status.ifu, nim: status.nim, tokenValid: status.tokenValid, version: status.version } : null } });
  } catch (error) {
    return handleApiError(error, "MECEF");
  }
}
