// src/lib/parent-session.ts
import crypto from "crypto";

export const COOKIE_NAME = "psess";

export type ParentClaims = {
  sid: string;   // student_id
  m: string;     // matricule
  uid: string;   // user_id du “parent fantôme” (auth.users)
  exp: number;   // timestamp (sec)
};

function b64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function hmacSHA256(secret: string, data: string) {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

/** Signe un JWT HS256 très simple (header+payload+signature) */
export function signParentJWT(
  payload: Omit<ParentClaims, "exp">,
  ttlSeconds = 60 * 60 * 24 * 30 // 30 jours
) {
  const sec = (process.env.PARENT_JWT_SECRET || "").trim();
  if (!sec) throw new Error("Missing PARENT_JWT_SECRET");

  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body: ParentClaims = { ...payload, exp } as ParentClaims;

  const head = b64url(JSON.stringify(header));
  const payl = b64url(JSON.stringify(body));
  const sig  = b64url(hmacSHA256(sec, `${head}.${payl}`));

  return `${head}.${payl}.${sig}`;
}

/** Vérifie signature/expiration et renvoie les claims, sinon null */
export function verifyParentJWT(token: string | null): ParentClaims | null {
  if (!token) return null;
  const sec = (process.env.PARENT_JWT_SECRET || "").trim();
  if (!sec) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, payl, sig] = parts;

  const expected = b64url(hmacSHA256(sec, `${head}.${payl}`));
  if (sig !== expected) return null;

  try {
    const claims = JSON.parse(Buffer.from(payl, "base64").toString("utf8")) as ParentClaims;
    if (!claims.exp || Date.now() / 1000 > Number(claims.exp)) return null;
    if (!claims.sid || !claims.m || !claims.uid) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Lit le cookie `psess` depuis une Request (Route Handler Next.js) */
export function readParentSessionFromReq(req: Request): ParentClaims | null {
  try {
    const raw = req.headers.get("cookie") || "";
    const m = raw.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
    const val = m ? decodeURIComponent(m[1]) : null;
    return verifyParentJWT(val);
  } catch {
    return null;
  }
}

/** Construit l’entête Set-Cookie pour enregistrer la session parent */
export function buildParentSessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production";
  const maxAge = 60 * 60 * 24 * 30; // 30 jours
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge};${
    secure ? " Secure;" : ""
  }`;
}

/** Construit l’entête Set-Cookie pour effacer la session parent */
export function clearParentSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;`;
}
