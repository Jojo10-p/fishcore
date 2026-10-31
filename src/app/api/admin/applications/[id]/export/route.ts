import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { audit } from "@/server/audit";

/** Export complet d'un dossier (JSON) : informations, historique, notes, documents (métadonnées). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.type !== "STAFF" || !user.can("applications.export")) return new NextResponse("Forbidden", { status: 403 });
  const app = await db.loanApplication.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: true,
      product: { select: { name: true, slug: true, category: true } },
      statusHistory: { orderBy: { createdAt: "asc" }, include: { actor: { select: { firstName: true, lastName: true } } } },
      internalNotes: { orderBy: { createdAt: "asc" }, include: { author: { select: { firstName: true, lastName: true } } } },
      documents: { where: { deletedAt: null }, select: { id: true, type: true, originalName: true, mimeType: true, size: true, sha256: true, status: true, reviewNote: true, createdAt: true } },
      documentRequests: true,
    },
  });
  if (!app) return new NextResponse("Not found", { status: 404 });
  await audit({ actorId: user.id, action: "application.exported", entity: "LoanApplication", entityId: id });
  return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), exportedBy: user.email, application: app }, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dossier-${app.reference}.json"`, "Cache-Control": "no-store" },
  });
}
