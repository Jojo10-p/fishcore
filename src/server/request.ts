import "server-only";
import { headers } from "next/headers";

export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}
