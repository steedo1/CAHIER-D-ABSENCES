import { createCipheriv, createDecipheriv, createHmac, createHash } from "node:crypto";

export const CARD_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export type CardTokenPayload = { institutionId: string; studentId: string; enrollmentId: string; classId: string; year: string };
function keys(secret: string) {
  if (secret.length < 32) throw Error("school_card_secret_missing");
  return { encryption: createHmac("sha256", secret).update("school-card:v1:encryption").digest(),
    nonce: createHmac("sha256", secret).update("school-card:v1:nonce").digest() };
}
function pack(payload: CardTokenPayload) {
  const ids = [payload.institutionId, payload.studentId, payload.enrollmentId, payload.classId];
  if (!ids.every(id => CARD_UUID.test(id)) || !/^\d{4}-\d{4}$/.test(payload.year)) throw Error("invalid_card_identity");
  return Buffer.concat([Buffer.from([1]), ...ids.map(id => Buffer.from(id.replaceAll("-", ""), "hex")), Buffer.from(payload.year)]);
}
/** Deterministic authenticated encryption; separate HMAC nonce key, no random
 * issuance timestamp. Identical identity/year => identical QR on every reprint.
 * 96-bit PRF nonces reveal equality only; identities are never in plaintext.
 * Never reuse these derived keys for any other protocol. */
export function issueCardToken(payload: CardTokenPayload, secret = process.env.SCHOOL_CARD_QR_SECRET || "") {
  const key = keys(secret), plain = pack(payload);
  const nonce = createHmac("sha256", key.nonce).update(plain).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", key.encryption, nonce);
  cipher.setAAD(Buffer.from("mon-cahier:school-card:v1"));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString("base64url");
}
export function openCardToken(token: unknown, secret = process.env.SCHOOL_CARD_QR_SECRET || ""): CardTokenPayload | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{136}$/.test(token)) return null;
  try {
    const key = keys(secret), data = Buffer.from(token, "base64url");
    if (data.toString("base64url") !== token || data.length !== 102) return null;
    const decipher = createDecipheriv("aes-256-gcm", key.encryption, data.subarray(0, 12));
    decipher.setAAD(Buffer.from("mon-cahier:school-card:v1"));
    decipher.setAuthTag(data.subarray(-16));
    const plain = Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]);
    if (plain.length !== 74 || plain[0] !== 1) return null;
    const uuid = (offset: number) => {
      const h = plain.subarray(offset, offset + 16).toString("hex");
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    };
    const payload = { institutionId: uuid(1), studentId: uuid(17), enrollmentId: uuid(33), classId: uuid(49), year: plain.subarray(65).toString() };
    return /^\d{4}-\d{4}$/.test(payload.year) ? payload : null;
  } catch { return null; }
}
export function cardFingerprint(token: string) { return createHash("sha256").update(token).digest("hex").slice(0, 10).toUpperCase(); }

/** Bounded, process-local abuse protection. Must be complemented by an edge
 * rate limit before scaling to several processes/instances. No raw IP stored. */
export function createCardScanLimiter(now = () => Date.now()) {
  const entries = new Map<string, { count: number; until: number }>();
  let global = { count: 0, until: 0 };
  return (ip: string, token: string) => {
    const time = now();
    if (time >= global.until) { global = { count: 0, until: time + 60_000 }; entries.clear(); }
    if (++global.count > 120) return false;
    const id = createHash("sha256").update(ip).digest("hex");
    for (const [key, limit] of [[`ip:${id}`, 12], [`token:${cardFingerprint(token)}`, 8]] as const) {
      const item = entries.get(key) || { count: 0, until: time + 60_000 };
      if (++item.count > limit) return false;
      entries.set(key, item);
    }
    return true;
  };
}
