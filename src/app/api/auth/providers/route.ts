import { NextResponse } from "next/server";
import { googleConfigured } from "@/lib/google";

// Relu à chaque appel : le bouton apparaît dès que GOOGLE_CLIENT_ID est réglé
export const dynamic = "force-dynamic";

// GET /api/auth/providers — moyens de connexion disponibles (public)
export async function GET() {
  return NextResponse.json({ success: true, data: { google: googleConfigured() } });
}
