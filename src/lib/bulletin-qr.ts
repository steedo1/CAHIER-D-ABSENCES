//src/lib/bulletin-qr.ts
import crypto from "crypto";

type BulletinQRPayload = {
  v: 1;
  instId: string;
  studentId: string;
  classId: string;
  academicYear?: string | null;
  termLabel?: string | null;
  iat: number; // timestamp ms
};

function b64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(s: string) {
  const pad = s.length % 4;
  const base64 = (pad ? s + "=".repeat(4 - pad) : s)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function signBulletinQR(payload: Omit<BulletinQRPayload, "v" | "iat">) {
  const secret = process.env.BULLETIN_QR_SECRET;
  if (!secret) throw new Error("BULLETIN_QR_SECRET manquant");

  const full: BulletinQRPayload = { v: 1, iat: Date.now(), ...payload };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(full), "utf8"));

  const sig = b64urlEncode(
    crypto.createHmac("sha256", secret).update(payloadB64).digest()
  );

  return `${payloadB64}.${sig}`;
}

export function verifyBulletinQR(token: string): BulletinQRPayload | null {
  const secret = process.env.BULLETIN_QR_SECRET;
  if (!secret) return null;

  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;

  const expected = b64urlEncode(
    crypto.createHmac("sha256", secret).update(payloadB64).digest()
  );

  if (!timingSafeEqualStr(sig, expected)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
    if (!payload || payload.v !== 1) return null;
    return payload as BulletinQRPayload;
  } catch {
    return null;
  }
}
