import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, parseBody, readJson } from "@/lib/auth";
import { loadThread } from "@/lib/cancellation-thread";
import { actorLabel, notifyManagers } from "@/lib/notify";
import { decodeVoice, voiceSchema } from "@/lib/voice";

type Params = { params: Promise<{ id: string }> };

// GET /api/cancellations/[id]/messages — L'échange (sans le son : il se charge à la demande)
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await loadThread(req, id);
    const rows = await prisma.cancellationMessage.findMany({
      where: { cancellationId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, authorId: true, text: true, audioSeconds: true, audioMime: true },
    });
    const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, firstName: true, lastName: true, role: true } });
    const by = new Map(authors.map((a) => [a.id, a]));
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({ ...r, hasAudio: !!r.audioMime, author: by.get(r.authorId) ?? null })),
    });
  } catch (error) {
    return handleApiError(error, "CANCELLATIONS");
  }
}

const postSchema = z
  .object({ text: z.string().trim().max(500).optional(), voice: voiceSchema.optional() })
  .refine((m) => !!m.text || !!m.voice, "Écrivez un message ou enregistrez une note vocale");

// POST /api/cancellations/[id]/messages — Répondre (texte ou note vocale)
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { user, c, decider } = await loadThread(req, id);
    const { text, voice } = parseBody(postSchema, await readJson(req));
    const audio = voice ? decodeVoice(voice) : null;
    const msg = await prisma.cancellationMessage.create({
      data: { cancellationId: id, authorId: user.id, text: text || null, ...(audio ?? {}) },
      select: { id: true, createdAt: true },
    });
    // Le patron/gérant écrit → le caissier est prévenu ; le caissier répond → patron et gérant
    const what = audio ? `🎤 note vocale (${audio.audioSeconds} s)${text ? ` : « ${text} »` : ""}` : `« ${text} »`;
    notifyManagers({
      companyId: c.sale.companyId,
      centerId: c.sale.centerId,
      actorId: user.id,
      ...(decider && c.requesterId !== user.id ? { userIds: [c.requesterId] } : {}),
      type: "CANCEL_MESSAGE",
      title: `Annulation ${c.sale.saleNumber} — nouveau message`,
      message: `${await actorLabel(user.id)} : ${what}`,
      link: "/annulations",
      data: { cancellationId: id, saleId: c.sale.id },
    });
    return NextResponse.json({ success: true, data: msg }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "CANCELLATIONS");
  }
}
