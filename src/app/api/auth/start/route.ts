import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { superAdmin } from "@/lib/super-admin";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Email invalide") });

// POST /api/auth/start — 1re étape de connexion.
// Tant qu'aucun super administrateur n'existe, on demande le code d'installation ;
// ensuite, tout le monde se connecte avec son mot de passe.
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Email invalide" }, { status: 400 });
  const admin = await superAdmin();
  return NextResponse.json({ success: true, data: { mode: admin ? "password" : "setup" } });
}
