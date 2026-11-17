import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApiError } from "@/lib/auth";
import { loadThread } from "@/lib/cancellation-thread";

// GET /api/cancellations/[id]/messages/[msgId] — Écouter une note vocale
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; msgId: string }> }) {
  try {
    const { id, msgId } = await params;
    await loadThread(req, id);
    const m = await prisma.cancellationMessage.findFirst({ where: { id: msgId, cancellationId: id }, select: { audio: true, audioMime: true } });
    if (!m?.audio || !m.audioMime) throw new ApiError(404, "Note vocale introuvable");
    return new NextResponse(Buffer.from(m.audio), {
      headers: { "Content-Type": m.audioMime, "Cache-Control": "private, max-age=86400", "Content-Length": String(m.audio.length) },
    });
  } catch (error) {
    return handleApiError(error, "CANCELLATIONS");
  }
}
