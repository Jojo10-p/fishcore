import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/data-crypto";
import { EmecfError, type EmecfMode } from "@/lib/emecf/client";
import { checkToken, TAX_GROUPS } from "@/lib/emecf/normalize";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";

const schema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["test", "production"]).optional(),
  /** Nouveau jeton e-MCF (fourni par la DGI) ; jamais renvoyé ensuite. */
  token: z.string().trim().min(20, "Jeton e-MCF incomplet").max(4000).optional(),
  defaultTaxGroup: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
});

async function view(companyId: string) {
  const [c, counts, failed] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { taxId: true, emecfEnabled: true, emecfMode: true, emecfTokenEnc: true, emecfNim: true, emecfTokenValidUntil: true, emecfDefaultTaxGroup: true },
    }),
    prisma.emecfDocument.groupBy({ by: ["status"], where: { companyId }, _count: true }),
    prisma.emecfDocument.findMany({
      where: { companyId, status: { in: ["FAILED", "PENDING", "SUBMITTED"] } },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true, type: true, status: true, lastError: true, attempts: true, createdAt: true, sale: { select: { id: true, saleNumber: true, totalAmount: true } } },
    }),
  ]);
  return {
    enabled: c.emecfEnabled,
    mode: c.emecfMode,
    hasToken: !!c.emecfTokenEnc,
    nim: c.emecfNim,
    tokenValidUntil: c.emecfTokenValidUntil,
    defaultTaxGroup: c.emecfDefaultTaxGroup,
    taxId: c.taxId,
    taxGroups: TAX_GROUPS,
    counts: Object.fromEntries(counts.map((x) => [x.status, x._count])),
    waiting: failed,
  };
}

// GET /api/company/emecf — Réglages et suivi de la facture normalisée
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "company:view");
    const companyId = requireCompany(user);
    return NextResponse.json({ success: true, data: await view(companyId) });
  } catch (error) {
    return handleApiError(error, "EMECF");
  }
}

const parseValidity = (v?: string) => {
  if (!v) return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v) : null;
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
  const d = iso ?? (fr ? new Date(`${fr[3]}-${fr[2]}-${fr[1]}T23:59:59`) : null);
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

// PUT /api/company/emecf — Active la facture normalisée ; le jeton est vérifié
// auprès de la DGI (il doit appartenir à l'IFU de l'entreprise) puis chiffré.
export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "company:edit");
    const companyId = requireCompany(user);
    const data = parseBody(schema, await readJson(req));
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { taxId: true, emecfEnabled: true, emecfMode: true, emecfTokenEnc: true, emecfDefaultTaxGroup: true },
    });
    const mode = (data.mode ?? company.emecfMode) as EmecfMode;
    const token = data.token ?? (company.emecfTokenEnc ? decryptSecret(company.emecfTokenEnc) : null);
    const enabling = data.enabled ?? company.emecfEnabled;

    let checked: { nim: string | null; validUntil: Date | null } | null = null;
    // Nouveau jeton, changement de mode ou activation : vérification auprès de la DGI
    if (token && (data.token || data.mode || (enabling && !company.emecfEnabled))) {
      if (!company.taxId || !/^\d{13}$/.test(company.taxId)) {
        throw new ApiError(400, "Renseignez d'abord l'IFU de l'entreprise (13 chiffres) dans les paramètres", "TAX_ID_REQUIRED");
      }
      try {
        const status = await checkToken(mode, token);
        if (status.ifu && status.ifu !== company.taxId) {
          throw new ApiError(400, `Ce jeton appartient à l'IFU ${status.ifu}, pas à celui de l'entreprise (${company.taxId})`, "EMECF_IFU_MISMATCH");
        }
        checked = { nim: status.nim ?? null, validUntil: parseValidity(status.tokenValid) };
      } catch (e) {
        if (e instanceof ApiError) throw e;
        const msg = e instanceof EmecfError ? e.message : "Vérification impossible";
        throw new ApiError(400, `Jeton non vérifié (${mode === "test" ? "bac à sable" : "production"}) : ${msg}`, "EMECF_TOKEN_INVALID");
      }
    }
    if (enabling && !token) throw new ApiError(400, "Collez le jeton e-MCF fourni par la DGI pour activer la facture normalisée", "EMECF_TOKEN_REQUIRED");

    await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          emecfEnabled: enabling,
          emecfMode: mode,
          ...(data.token ? { emecfTokenEnc: encryptSecret(data.token) } : {}),
          ...(checked ? { emecfNim: checked.nim, emecfTokenValidUntil: checked.validUntil } : {}),
          ...(data.defaultTaxGroup ? { emecfDefaultTaxGroup: data.defaultTaxGroup } : {}),
        },
      });
      // Réglage corrigé : les factures refusées sont reprises tout de suite
      await tx.emecfDocument.updateMany({ where: { companyId, status: "FAILED" }, data: { nextAttemptAt: null } });
      await writeAuditLog(
        {
          eventType: "COMPANY_SETTINGS_CHANGED",
          companyId,
          userId: user.id,
          referenceType: "Company",
          referenceId: companyId,
          result: "SUCCESS",
          oldValues: { emecfEnabled: company.emecfEnabled, emecfMode: company.emecfMode, emecfDefaultTaxGroup: company.emecfDefaultTaxGroup },
          newValues: { emecfEnabled: enabling, emecfMode: mode, emecfDefaultTaxGroup: data.defaultTaxGroup ?? company.emecfDefaultTaxGroup, tokenChanged: !!data.token, nim: checked?.nim ?? undefined },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
    });
    return NextResponse.json({ success: true, data: await view(companyId) });
  } catch (error) {
    return handleApiError(error, "EMECF");
  }
}
