import { z } from "zod";
import { ApiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Note vocale envoyée par le navigateur (enregistrée au micro), en base64.
// Une minute et demie au plus : quelques dizaines de Ko en Opus.
export const MAX_VOICE_SECONDS = 90;
const MAX_VOICE_BYTES = 1_500_000;

export const voiceSchema = z.object({
  data: z.string().min(10).max(Math.ceil((MAX_VOICE_BYTES * 4) / 3) + 8),
  mime: z.string().regex(/^audio\/[a-z0-9.+-]+(;\s*codecs=[a-z0-9.,"-]+)?$/i, "Format audio invalide"),
  seconds: z.coerce.number().int().min(1).max(MAX_VOICE_SECONDS),
});
export type VoiceInput = z.infer<typeof voiceSchema>;

export function decodeVoice(v: VoiceInput): { audio: Uint8Array<ArrayBuffer>; audioMime: string; audioSeconds: number } {
  const buf = Buffer.from(v.data, "base64");
  if (buf.length < 100) throw new ApiError(400, "Note vocale vide", "VOICE_EMPTY");
  if (buf.length > MAX_VOICE_BYTES) throw new ApiError(400, "Note vocale trop longue", "VOICE_TOO_BIG");
  const audio = new Uint8Array(new ArrayBuffer(buf.length));
  audio.set(buf);
  return { audio, audioMime: v.mime.split(";")[0].toLowerCase(), audioSeconds: v.seconds };
}

/** Notes vocales gardées 30 jours, puis effacées pour libérer la place (le texte reste). */
export const VOICE_KEEP_DAYS = 30;
let lastPurge = 0;
export async function purgeOldVoiceNotes(now = new Date()): Promise<number> {
  // Au plus une fois par heure et par serveur
  if (now.getTime() - lastPurge < 3600_000) return 0;
  lastPurge = now.getTime();
  const r = await prisma.cancellationMessage.updateMany({
    where: { audioMime: { not: null }, createdAt: { lt: new Date(now.getTime() - VOICE_KEEP_DAYS * 24 * 3600_000) } },
    data: { audio: null, audioMime: null },
  });
  return r.count;
}
