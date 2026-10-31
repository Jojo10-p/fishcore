import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "aur_session";

export interface SessionClaims {
  sid: string;
  uid: string;
  typ: "CUSTOMER" | "STAFF";
}

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET manquant ou trop court");
  return new TextEncoder().encode(s);
}

export async function signSession(claims: SessionClaims, expiresAt: Date) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.sid !== "string" || typeof payload.uid !== "string") return null;
    if (payload.typ !== "CUSTOMER" && payload.typ !== "STAFF") return null;
    return { sid: payload.sid, uid: payload.uid, typ: payload.typ };
  } catch {
    return null;
  }
}
