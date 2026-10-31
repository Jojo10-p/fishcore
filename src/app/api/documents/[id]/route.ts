import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { readPrivate } from "@/server/storage";
import { audit } from "@/server/audit";

/** Accès contrôlé aux justificatifs : propriétaire du document ou membre habilité (documents.view). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const doc = await db.applicationDocument.findFirst({ where: { id, deletedAt: null } });
  if (!doc) return new NextResponse("Not found", { status: 404 });
  const allowed = user.type === "STAFF" ? user.can("documents.view") : user.customer?.id === doc.customerId;
  if (!allowed) return new NextResponse("Not found", { status: 404 });
  const buf = await readPrivate(doc.storageKey).catch(() => null);
  if (!buf) return new NextResponse("Fichier indisponible", { status: 410 });
  if (user.type === "STAFF") await audit({ actorId: user.id, action: "document.viewed", entity: "ApplicationDocument", entityId: doc.id });
  const download = new URL(req.url).searchParams.has("download");
  const name = encodeURIComponent(doc.originalName);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(buf.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
