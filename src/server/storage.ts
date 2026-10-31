import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";

/** "filesystem" (VPS, disque persistant) ou "database" (serverless : Vercel…). */
const useDb = () => process.env.STORAGE_DRIVER === "database";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

function root(sub: "private" | "media") {
  const base = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "./storage/private");
  return sub === "private" ? base : path.resolve(base, "..", "media");
}

export class UploadError extends Error {}

/** Valide le contenu réel du fichier (signature binaire), pas seulement l'extension. */
export async function inspectUpload(file: File, allowed: string[] = ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
  if (!file || typeof file === "string" || file.size === 0) throw new UploadError("Fichier vide.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("Fichier trop volumineux (8 Mo maximum).");
  const buffer = Buffer.from(await file.arrayBuffer());
  const sig = SIGNATURES.find((s) => s.test(buffer));
  if (!sig || !allowed.includes(sig.mime)) throw new UploadError("Format non accepté. Formats autorisés : PDF, JPG, PNG, WEBP.");
  const originalName = (file.name || `document.${sig.ext}`).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
  return { buffer, mime: sig.mime, ext: sig.ext, originalName, size: buffer.length };
}

export async function storePrivate(buffer: Buffer, ext: string) {
  const now = new Date();
  const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
  if (useDb()) {
    await db.storedFile.create({ data: { key: `private/${key}`, data: new Uint8Array(buffer) } });
  } else {
    const full = path.join(root("private"), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer, { mode: 0o600 });
  }
  return { key, sha256: createHash("sha256").update(buffer).digest("hex") };
}

function safeJoin(base: string, key: string) {
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error("Chemin invalide");
  return full;
}

async function readDb(key: string) {
  const f = await db.storedFile.findUnique({ where: { key } });
  if (!f) throw new Error("not found");
  return Buffer.from(f.data);
}

export const readPrivate = (key: string) => (useDb() ? readDb(`private/${key}`) : readFile(safeJoin(root("private"), key)));
export const deletePrivate = (key: string) =>
  useDb() ? db.storedFile.delete({ where: { key: `private/${key}` } }).then(() => undefined).catch(() => undefined) : unlink(safeJoin(root("private"), key)).catch(() => undefined);

export async function storeMedia(buffer: Buffer, ext: string) {
  const key = `${randomUUID()}.${ext}`;
  if (useDb()) {
    await db.storedFile.create({ data: { key: `media/${key}`, data: new Uint8Array(buffer) } });
    return key;
  }
  const full = safeJoin(root("media"), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer);
  return key;
}
export const readMedia = (key: string) => (useDb() ? readDb(`media/${key}`) : readFile(safeJoin(root("media"), key)));
