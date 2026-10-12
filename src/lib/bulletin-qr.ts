//src/lib/bulletin-qr.ts
import crypto from "crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

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
  const json = Buffer.from(JSON.stringify(full), "utf8");
  let payloadB64 = b64urlEncode(json);
  // Les aperçus sans code court gardent le snapshot complet sans INSERT.
  // Un JSON volumineux dépasse la capacité du QR ; le compresser conserve
  // les notes, rangs et métadonnées historiques sans les recalculer au scan.
  if (json.length > 1024) {
    const compressed = `z:${b64urlEncode(deflateRawSync(json, { level: 9 }))}`;
    if (compressed.length < payloadB64.length) payloadB64 = compressed;
  }

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
    // Vérifier le HMAC avant toute décompression. Le format JSON historique
    // reste accepté ; la sortie compressée est bornée pour éviter les bombes.
    const json = payloadB64.startsWith("z:")
      ? inflateRawSync(b64urlDecode(payloadB64.slice(2)), { maxOutputLength: 128 * 1024 })
      : b64urlDecode(payloadB64);
    const payload = JSON.parse(json.toString("utf8"));
    if (!payload || payload.v !== 1) return null;
    return payload as BulletinQRPayload;
  } catch {
    return null;
  }
}
