export type OfflineLoginIdentifierKind = "email" | "phone";

export type OfflineCredentialVerifier = {
  algorithm: "PBKDF2-SHA-256";
  iterations: number;
  salt_b64: string;
  verifier_b64: string;
};

export const OFFLINE_LOGIN_PBKDF2_ITERATIONS = 210_000;
export const OFFLINE_LOGIN_MIN_ITERATIONS = 100_000;
export const OFFLINE_LOGIN_MAX_ITERATIONS = 1_000_000;

function cryptoApi(): Crypto {
  const api = globalThis.crypto;
  if (!api?.subtle || typeof api.getRandomValues !== "function") {
    throw new Error("OFFLINE_LOGIN_BROWSER_UNSUPPORTED");
  }
  return api;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error("OFFLINE_LOGIN_CREDENTIAL_INVALID");
  }
}

function validIterations(value: unknown): number {
  const iterations = Number(value);
  if (
    !Number.isInteger(iterations) ||
    iterations < OFFLINE_LOGIN_MIN_ITERATIONS ||
    iterations > OFFLINE_LOGIN_MAX_ITERATIONS
  ) {
    throw new Error("OFFLINE_LOGIN_CREDENTIAL_INVALID");
  }
  return iterations;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function secretMaterial(identifier: string, password: string): Uint8Array {
  const normalizedIdentifier = String(identifier || "").trim();
  const normalizedPassword = String(password || "");
  if (!normalizedIdentifier || !normalizedPassword) {
    throw new Error("OFFLINE_LOGIN_SECRET_REQUIRED");
  }
  return new TextEncoder().encode(
    `mon-cahier-offline-login-v1\n${normalizedIdentifier}\n${normalizedPassword}`,
  );
}

async function deriveVerifier(input: {
  identifier: string;
  password: string;
  salt: Uint8Array;
  iterations: number;
}): Promise<Uint8Array> {
  const api = cryptoApi();
  const key = await api.subtle.importKey(
    "raw",
    toArrayBuffer(secretMaterial(input.identifier, input.password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await api.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(input.salt),
      iterations: validIterations(input.iterations),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

export async function createOfflineCredentialVerifier(input: {
  identifier: string;
  password: string;
  iterations?: number;
  salt?: Uint8Array;
}): Promise<OfflineCredentialVerifier> {
  const api = cryptoApi();
  const iterations = validIterations(
    input.iterations ?? OFFLINE_LOGIN_PBKDF2_ITERATIONS,
  );
  const salt = input.salt
    ? new Uint8Array(input.salt)
    : api.getRandomValues(new Uint8Array(16));
  if (salt.length < 16 || salt.length > 64) {
    throw new Error("OFFLINE_LOGIN_CREDENTIAL_INVALID");
  }

  const verifier = await deriveVerifier({
    identifier: input.identifier,
    password: input.password,
    salt,
    iterations,
  });

  return {
    algorithm: "PBKDF2-SHA-256",
    iterations,
    salt_b64: bytesToBase64(salt),
    verifier_b64: bytesToBase64(verifier),
  };
}

export async function verifyOfflineCredentialSecret(
  verifier: OfflineCredentialVerifier,
  input: { identifier: string; password: string },
): Promise<boolean> {
  if (verifier?.algorithm !== "PBKDF2-SHA-256") {
    throw new Error("OFFLINE_LOGIN_CREDENTIAL_INVALID");
  }
  const salt = base64ToBytes(verifier.salt_b64);
  const expected = base64ToBytes(verifier.verifier_b64);
  if (salt.length < 16 || expected.length !== 32) {
    throw new Error("OFFLINE_LOGIN_CREDENTIAL_INVALID");
  }

  const actual = await deriveVerifier({
    identifier: input.identifier,
    password: input.password,
    salt,
    iterations: verifier.iterations,
  });
  return constantTimeEqual(actual, expected);
}

export function isIsoDateInFuture(value: unknown, nowMs = Date.now()): boolean {
  const timestamp = new Date(String(value || "")).getTime();
  return Number.isFinite(timestamp) && timestamp > nowMs;
}

export function remainingLockSeconds(
  lockedUntil: unknown,
  nowMs = Date.now(),
): number {
  const timestamp = new Date(String(lockedUntil || "")).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= nowMs) return 0;
  return Math.max(1, Math.ceil((timestamp - nowMs) / 1000));
}
