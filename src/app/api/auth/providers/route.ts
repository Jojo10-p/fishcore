import { NextResponse } from "next/server";
import { googleConfigured } from "@/lib/google";

// GET /api/auth/providers — moyens de connexion disponibles (public)
export async function GET() {
  return NextResponse.json({ success: true, data: { google: googleConfigured() } });
}
