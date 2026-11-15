import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestMeta } from "@/lib/auth";
import { superAdmin, verifySetupCode } from "@/lib/super-admin";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Email invalide"), code: z.string().min(4, "Code requis").max(40) });

// POST /api/auth/setup/check — Vérifie le code d'installation avant de remplir le formulaire.
// Réponse : "install" (créer le super administrateur) ou "reset" (il existe : nouveau mot de passe).
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 400 });
  const { email, code } = parsed.data;
  const admin = await superAdmin();
  if (admin && admin.email !== email) return NextResponse.json({ success: false, error: "Ce code ne concerne pas cette adresse." }, { status: 403 });
  const r = await verifySetupCode(email, code, requestMeta(req).ipAddress);
  if (r === "locked") return NextResponse.json({ success: false, error: "Trop d'essais. Réessayez dans une heure." }, { status: 429 });
  if (r === "bad") return NextResponse.json({ success: false, error: "Code d'installation incorrect." }, { status: 400 });
  return NextResponse.json({ success: true, data: { mode: admin ? "reset" : "install" } });
}
