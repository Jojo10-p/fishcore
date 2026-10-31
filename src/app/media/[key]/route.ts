import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readMedia } from "@/server/storage";

/** Médias publics (logo, bannières) téléversés depuis le back-office. */
export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(key)) return new NextResponse("Not found", { status: 404 });
  const asset = await db.mediaAsset.findUnique({ where: { storageKey: key } });
  if (!asset) return new NextResponse("Not found", { status: 404 });
  const buf = await readMedia(key).catch(() => null);
  if (!buf) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": asset.mimeType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
