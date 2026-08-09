export const OFFLINE_ACCESS_COOKIE = "mc_offline_access";
export const OFFLINE_DEVICE_COOKIE = "mc_offline_device";
export const OFFLINE_AUTH_VERSION = 1 as const;
export const OFFLINE_PBKDF2_ITERATIONS = 210_000;

export const OFFLINE_ROLE_DESTINATIONS = {
  teacher: "/attendance",
  class_device: "/class",
  admin: "/admin/absences/appels-matrice",
} as const;

export type OfflineAccessRole = keyof typeof OFFLINE_ROLE_DESTINATIONS;
export type OfflineAccessDestination =
  (typeof OFFLINE_ROLE_DESTINATIONS)[OfflineAccessRole];

export type OfflineAccessGrantPayload = {
  version: typeof OFFLINE_AUTH_VERSION;
  grant_id: string;
  user_id: string;
  institution_id: string;
  class_id: string | null;
  device_id: string;
  role: OfflineAccessRole;
  destination: OfflineAccessDestination;
  account_active: true;
  issued_at: number;
  expires_at: number;
};

const encoder = new TextEncoder();

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  return base64ToBytes(normalized + (padding ? "=".repeat(4 - padding) : ""));
}

export function isOfflineAccessRole(value: unknown): value is OfflineAccessRole {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(OFFLINE_ROLE_DESTINATIONS, value)
  );
}

export function offlineDestinationForRole(
  role: unknown,
): OfflineAccessDestination | null {
  return isOfflineAccessRole(role) ? OFFLINE_ROLE_DESTINATIONS[role] : null;
}

export function isOfflineAccessDestination(
  pathname: string,
): pathname is OfflineAccessDestination {
  return Object.values(OFFLINE_ROLE_DESTINATIONS).includes(
    pathname as OfflineAccessDestination,
  );
}

function validPayload(value: unknown): value is OfflineAccessGrantPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<OfflineAccessGrantPayload>;
  const expectedDestination = offlineDestinationForRole(payload.role);
  return (
    payload.version === OFFLINE_AUTH_VERSION &&
    typeof payload.grant_id === "string" &&
    payload.grant_id.length >= 8 &&
    typeof payload.user_id === "string" &&
    payload.user_id.length >= 8 &&
    typeof payload.institution_id === "string" &&
    payload.institution_id.length >= 1 &&
    ((payload.role === "class_device" &&
      typeof payload.class_id === "string" &&
      payload.class_id.length >= 8) ||
      (payload.role !== "class_device" && payload.class_id === null)) &&
    typeof payload.device_id === "string" &&
    payload.device_id.length >= 16 &&
    payload.device_id.length <= 128 &&
    payload.account_active === true &&
    expectedDestination !== null &&
    payload.destination === expectedDestination &&
    Number.isSafeInteger(payload.issued_at) &&
    Number.isSafeInteger(payload.expires_at) &&
    Number(payload.expires_at) > Number(payload.issued_at)
  );
}

export function decodeOfflineAccessGrant(
  token: string,
): OfflineAccessGrantPayload | null {
  try {
    const [encodedPayload, encodedSignature, extra] = token.split(".");
    if (!encodedPayload || !encodedSignature || extra) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload)),
    );
    return validPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      ownedArrayBuffer(encoder.encode(message)),
    ),
  );
}

export function equalOfflineSecret(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function deriveOfflinePasswordVerifier(
  password: string,
  salt: Uint8Array,
  iterations = OFFLINE_PBKDF2_ITERATIONS,
) {
  if (!password) throw new Error("offline_password_required");
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) {
    throw new Error("offline_pbkdf2_iterations_invalid");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(encoder.encode(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: ownedArrayBuffer(salt),
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function issueOfflineAccessGrant(input: {
  secret: string;
  userId: string;
  institutionId: string;
  classId?: string | null;
  deviceId: string;
  role: OfflineAccessRole;
  nowMs?: number;
  ttlMs?: number;
  grantId?: string;
}) {
  const nowMs = Math.floor(input.nowMs ?? Date.now());
  const ttlMs = Math.floor(input.ttlMs ?? 30 * 24 * 60 * 60 * 1_000);
  if (input.secret.length < 32) throw new Error("offline_auth_secret_invalid");
  if (!/^[A-Za-z0-9:_-]{16,128}$/.test(input.deviceId)) {
    throw new Error("offline_device_id_invalid");
  }
  if (!input.userId.trim() || !input.institutionId.trim()) {
    throw new Error("offline_grant_scope_invalid");
  }
  const classId = String(input.classId || "").trim();
  if (input.role === "class_device" && !classId) {
    throw new Error("offline_class_device_scope_invalid");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000) {
    throw new Error("offline_grant_ttl_invalid");
  }

  const payload: OfflineAccessGrantPayload = {
    version: OFFLINE_AUTH_VERSION,
    grant_id: input.grantId || crypto.randomUUID(),
    user_id: input.userId.trim(),
    institution_id: input.institutionId.trim(),
    class_id: input.role === "class_device" ? classId : null,
    device_id: input.deviceId,
    role: input.role,
    destination: OFFLINE_ROLE_DESTINATIONS[input.role],
    account_active: true,
    issued_at: nowMs,
    expires_at: nowMs + ttlMs,
  };
  const encodedPayload = encodeBase64Url(
    encoder.encode(JSON.stringify(payload)),
  );
  const signature = encodeBase64Url(await hmac(input.secret, encodedPayload));
  return { token: `${encodedPayload}.${signature}`, payload };
}

export async function verifyOfflineAccessGrant(input: {
  token: string;
  secret: string;
  pathname: string;
  deviceId?: string | null;
  nowMs?: number;
}) {
  if (input.secret.length < 32) return null;
  const [encodedPayload, encodedSignature, extra] = input.token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;
  const payload = decodeOfflineAccessGrant(input.token);
  if (!payload) return null;
  const nowMs = Math.floor(input.nowMs ?? Date.now());
  if (payload.issued_at > nowMs + 5 * 60_000 || payload.expires_at <= nowMs) {
    return null;
  }
  if (payload.destination !== input.pathname) return null;
  if (input.deviceId && payload.device_id !== input.deviceId) return null;
  try {
    const actual = decodeBase64Url(encodedSignature);
    const expected = await hmac(input.secret, encodedPayload);
    return equalOfflineSecret(actual, expected) ? payload : null;
  } catch {
    return null;
  }
}
