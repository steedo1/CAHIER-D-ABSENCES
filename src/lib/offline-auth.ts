"use client";

import { cacheGet, cacheSet } from "@/lib/offline";
import { MON_CAHIER_SERVICE_WORKER_RELEASE } from "@/lib/offline-release";
import { normalizePhone } from "@/lib/phone";
import {
  createOfflineCredentialVerifier,
  isIsoDateInFuture,
  remainingLockSeconds,
  verifyOfflineCredentialSecret,
  type OfflineCredentialVerifier,
  type OfflineLoginIdentifierKind,
} from "@/lib/offline-auth-core";

export type OfflineLoginRole = "teacher" | "class-device";

export type OfflineLoginCredential = OfflineCredentialVerifier & {
  version: 1;
  user_id: string;
  identifier_kind: OfflineLoginIdentifierKind;
  identifier_normalized: string;
  role: OfflineLoginRole;
  institution_id: string | null;
  destination: "/choose-book";
  created_at: string;
  expires_at: string;
  failed_attempts: number;
  locked_until: string | null;
};

export type OfflineLoginSession = {
  version: 1;
  user_id: string;
  role: OfflineLoginRole;
  institution_id: string | null;
  destination: "/choose-book";
  issued_at: string;
  expires_at: string;
};

type OfflineReadinessSummary = {
  version?: number;
  role?: string;
  shell_ready?: boolean;
  prepared_at?: string;
  service_worker_release?: string;
};

export type OfflineLoginAvailability = {
  available: boolean;
  role: OfflineLoginRole | null;
  reason:
    | "ready"
    | "not_configured"
    | "expired"
    | "locked"
    | "not_prepared"
    | "stale_shell";
  locked_seconds: number;
};

const CREDENTIAL_KEY = "offline:auth:credential:v1";
export const OFFLINE_LOGIN_SESSION_KEY = "moncahier:offline-session:v1";
const OFFLINE_LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OFFLINE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

function browser() {
  return typeof window !== "undefined";
}

function readinessKey(role: OfflineLoginRole) {
  return `offline:readiness:${role}`;
}

function normalizeIdentifier(
  kind: OfflineLoginIdentifierKind,
  raw: string,
): string | null {
  if (kind === "email") {
    const email = String(raw || "").trim().toLowerCase();
    return email && email.includes("@") ? email : null;
  }
  return normalizePhone(raw, { defaultCountryAlpha2: "CI" });
}

function supportedRole(role: unknown): OfflineLoginRole | null {
  if (role === "teacher") return "teacher";
  if (role === "class_device" || role === "class-device") return "class-device";
  return null;
}

function validCredential(value: unknown): value is OfflineLoginCredential {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<OfflineLoginCredential>;
  return (
    row.version === 1 &&
    (row.role === "teacher" || row.role === "class-device") &&
    (row.identifier_kind === "email" || row.identifier_kind === "phone") &&
    typeof row.user_id === "string" &&
    row.user_id.trim().length > 0 &&
    typeof row.identifier_normalized === "string" &&
    row.identifier_normalized.trim().length > 0 &&
    row.destination === "/choose-book" &&
    row.algorithm === "PBKDF2-SHA-256" &&
    typeof row.salt_b64 === "string" &&
    typeof row.verifier_b64 === "string"
  );
}

async function readCredential(): Promise<OfflineLoginCredential | null> {
  const value = await cacheGet<OfflineLoginCredential>(CREDENTIAL_KEY).catch(
    () => null,
  );
  return validCredential(value) ? value : null;
}

export async function getOfflineLoginOwnerUserId(): Promise<string | null> {
  const credential = await readCredential();
  return credential?.user_id || null;
}

async function readReadiness(
  role: OfflineLoginRole,
): Promise<OfflineReadinessSummary | null> {
  return await cacheGet<OfflineReadinessSummary>(readinessKey(role)).catch(
    () => null,
  );
}

function readinessStatus(
  role: OfflineLoginRole,
  readiness: OfflineReadinessSummary | null,
): "ready" | "not_prepared" | "stale_shell" {
  if (
    !readiness ||
    readiness.role !== role ||
    readiness.version !== 5 ||
    readiness.shell_ready !== true
  ) {
    return "not_prepared";
  }
  if (
    readiness.service_worker_release &&
    readiness.service_worker_release !== MON_CAHIER_SERVICE_WORKER_RELEASE
  ) {
    return "stale_shell";
  }
  return "ready";
}

function writeOfflineSession(credential: OfflineLoginCredential, now: Date) {
  if (!browser()) throw new Error("OFFLINE_LOGIN_BROWSER_UNSUPPORTED");
  const credentialExpiry = new Date(credential.expires_at).getTime();
  const sessionExpiry = Math.min(
    credentialExpiry,
    now.getTime() + OFFLINE_SESSION_TTL_MS,
  );
  const session: OfflineLoginSession = {
    version: 1,
    user_id: credential.user_id,
    role: credential.role,
    institution_id: credential.institution_id,
    destination: credential.destination,
    issued_at: now.toISOString(),
    expires_at: new Date(sessionExpiry).toISOString(),
  };
  window.localStorage.setItem(
    OFFLINE_LOGIN_SESSION_KEY,
    JSON.stringify(session),
  );
  return session;
}

export function clearOfflineLoginSession() {
  if (!browser()) return;
  try {
    window.localStorage.removeItem(OFFLINE_LOGIN_SESSION_KEY);
  } catch {
    // Nettoyage tolérant.
  }
}

export function readOfflineLoginSession(
  nowMs = Date.now(),
): OfflineLoginSession | null {
  if (!browser()) return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(OFFLINE_LOGIN_SESSION_KEY) || "null",
    ) as Partial<OfflineLoginSession> | null;
    if (
      !parsed ||
      parsed.version !== 1 ||
      (parsed.role !== "teacher" && parsed.role !== "class-device") ||
      parsed.destination !== "/choose-book" ||
      !parsed.user_id ||
      !isIsoDateInFuture(parsed.expires_at, nowMs)
    ) {
      clearOfflineLoginSession();
      return null;
    }
    return parsed as OfflineLoginSession;
  } catch {
    clearOfflineLoginSession();
    return null;
  }
}

export async function enrollOfflineLogin(input: {
  identifierKind: OfflineLoginIdentifierKind;
  identifier: string;
  password: string;
  userId: string;
  role: unknown;
  institutionId?: string | null;
  now?: Date;
}): Promise<{ enrolled: boolean; role: OfflineLoginRole | null }> {
  const role = supportedRole(input.role);
  if (!role) {
    clearOfflineLoginSession();
    return { enrolled: false, role: null };
  }

  const identifier = normalizeIdentifier(input.identifierKind, input.identifier);
  const userId = String(input.userId || "").trim();
  if (!identifier || !userId || !input.password) {
    throw new Error("OFFLINE_LOGIN_SECRET_REQUIRED");
  }

  const now = input.now ?? new Date();
  const verifier = await createOfflineCredentialVerifier({
    identifier,
    password: input.password,
  });
  const credential: OfflineLoginCredential = {
    version: 1,
    user_id: userId,
    identifier_kind: input.identifierKind,
    identifier_normalized: identifier,
    role,
    institution_id:
      String(input.institutionId || "").trim() || null,
    destination: "/choose-book",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + OFFLINE_LOGIN_TTL_MS).toISOString(),
    failed_attempts: 0,
    locked_until: null,
    ...verifier,
  };

  await cacheSet(CREDENTIAL_KEY, credential);
  clearOfflineLoginSession();
  return { enrolled: true, role };
}

export async function getOfflineLoginAvailability(
  now = new Date(),
): Promise<OfflineLoginAvailability> {
  const credential = await readCredential();
  if (!credential) {
    return {
      available: false,
      role: null,
      reason: "not_configured",
      locked_seconds: 0,
    };
  }
  if (!isIsoDateInFuture(credential.expires_at, now.getTime())) {
    return {
      available: false,
      role: credential.role,
      reason: "expired",
      locked_seconds: 0,
    };
  }

  const lockedSeconds = remainingLockSeconds(
    credential.locked_until,
    now.getTime(),
  );
  if (lockedSeconds > 0) {
    return {
      available: false,
      role: credential.role,
      reason: "locked",
      locked_seconds: lockedSeconds,
    };
  }

  const readiness = await readReadiness(credential.role);
  const status = readinessStatus(credential.role, readiness);
  return {
    available: status === "ready",
    role: credential.role,
    reason: status,
    locked_seconds: 0,
  };
}

async function recordFailure(
  credential: OfflineLoginCredential,
  now: Date,
): Promise<void> {
  const attempts = Number(credential.failed_attempts || 0) + 1;
  const locked = attempts >= MAX_FAILED_ATTEMPTS;
  await cacheSet(CREDENTIAL_KEY, {
    ...credential,
    failed_attempts: locked ? MAX_FAILED_ATTEMPTS : attempts,
    locked_until: locked
      ? new Date(now.getTime() + LOCK_DURATION_MS).toISOString()
      : null,
  } satisfies OfflineLoginCredential);
}

export async function authenticateOfflineLogin(input: {
  identifierKind: OfflineLoginIdentifierKind;
  identifier: string;
  password: string;
  now?: Date;
}): Promise<{
  ok: true;
  role: OfflineLoginRole;
  destination: "/choose-book";
  session: OfflineLoginSession;
}> {
  const now = input.now ?? new Date();
  const credential = await readCredential();
  if (!credential) throw new Error("OFFLINE_LOGIN_NOT_CONFIGURED");

  if (!isIsoDateInFuture(credential.expires_at, now.getTime())) {
    clearOfflineLoginSession();
    throw new Error("OFFLINE_LOGIN_EXPIRED");
  }

  const lockedSeconds = remainingLockSeconds(
    credential.locked_until,
    now.getTime(),
  );
  if (lockedSeconds > 0) {
    throw new Error(`OFFLINE_LOGIN_LOCKED:${lockedSeconds}`);
  }

  const readiness = await readReadiness(credential.role);
  const status = readinessStatus(credential.role, readiness);
  if (status === "not_prepared") {
    throw new Error("OFFLINE_LOGIN_NOT_PREPARED");
  }
  if (status === "stale_shell") {
    throw new Error("OFFLINE_LOGIN_SHELL_STALE");
  }

  const identifier = normalizeIdentifier(input.identifierKind, input.identifier);
  const identityMatches =
    input.identifierKind === credential.identifier_kind &&
    identifier === credential.identifier_normalized;
  let passwordMatches = false;
  if (identityMatches && identifier && input.password) {
    passwordMatches = await verifyOfflineCredentialSecret(credential, {
      identifier,
      password: input.password,
    });
  }

  if (!identityMatches || !passwordMatches) {
    clearOfflineLoginSession();
    await recordFailure(credential, now);
    throw new Error("OFFLINE_LOGIN_INVALID");
  }

  const refreshed: OfflineLoginCredential = {
    ...credential,
    failed_attempts: 0,
    locked_until: null,
  };
  await cacheSet(CREDENTIAL_KEY, refreshed);
  const session = writeOfflineSession(refreshed, now);
  return {
    ok: true,
    role: refreshed.role,
    destination: refreshed.destination,
    session,
  };
}
