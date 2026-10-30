import { NextRequest, NextResponse } from "next/server";
import { verifyAuditChain } from "@/lib/audit";
import { getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";

// GET /api/audit/verify — Vérifie que le journal n'a pas été altéré (chaîne de hachage)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "audit:view");
    const companyId = requireCompany(user);
    const result = await verifyAuditChain(companyId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, "AUDIT");
  }
}
