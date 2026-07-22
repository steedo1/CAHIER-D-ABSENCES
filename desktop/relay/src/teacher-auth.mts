import { createHmac, timingSafeEqual } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { parseStoredJson } from "./json.mjs";

type RelayAccessPayload = {
  v: 1;
  purpose: "attendance_relay_access";
  institution_id: string;
  actor_profile_id: string;
  issued_at: string;
  expires_at: string;
};

type RelayAttendanceSettings = {
  relay_presence_secret?: string;
};

export type AuthenticatedRelayTeacher = {
  institution_id: string;
  actor_profile_id: string;
};

type ExpectedRelayTeacher = {
  institutionId?: string;
  actorProfileId?: string;
};

function requiredClaim(value: unknown, name: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${name}_required`);
  if (normalized.length > 256) throw new Error(`${name}_too_long`);
  return normalized;
}

function parseUnverifiedAccessToken(token: string) {
  const normalized = String(token || "").trim();
  if (!normalized || normalized.length > 4096) throw new Error("relay_access_token_invalid");
  const [encodedPayload, encodedSignature, extra] = normalized.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("relay_access_token_invalid");

  let payload: RelayAccessPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as RelayAccessPayload;
  } catch {
    throw new Error("relay_access_token_payload_invalid");
  }

  return { encodedPayload, encodedSignature, payload };
}

export function authenticateRelayTeacherAccess(
  db: RelayDatabase,
  token: string,
  now = new Date(),
  expected: ExpectedRelayTeacher = {},
): AuthenticatedRelayTeacher {
  const parsed = parseUnverifiedAccessToken(token);
  const institutionId = requiredClaim(parsed.payload.institution_id, "institution_id");
  const actorProfileId = requiredClaim(parsed.payload.actor_profile_id, "actor_profile_id");

  const institution = db.prepare(`
    SELECT settings_json FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(institutionId) as { settings_json: string | null } | undefined;
  if (!institution) throw new Error("institution_not_initialized");

  const settings = parseStoredJson<Record<string, unknown>>(institution.settings_json) || {};
  const attendance = (
    settings.attendance_presence && typeof settings.attendance_presence === "object"
      ? settings.attendance_presence
      : {}
  ) as RelayAttendanceSettings;
  const secret = String(attendance.relay_presence_secret || "").trim();
  if (secret.length < 32) throw new Error("relay_presence_secret_missing");

  const expectedSignature = createHmac("sha256", secret).update(parsed.encodedPayload).digest();
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(parsed.encodedSignature, "base64url");
  } catch {
    throw new Error("relay_access_token_signature_invalid");
  }
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new Error("relay_access_token_signature_invalid");
  }

  const issuedAt = new Date(parsed.payload.issued_at).getTime();
  const expiresAt = new Date(parsed.payload.expires_at).getTime();
  if (
    parsed.payload.v !== 1 ||
    parsed.payload.purpose !== "attendance_relay_access" ||
    institutionId !== parsed.payload.institution_id ||
    actorProfileId !== parsed.payload.actor_profile_id
  ) {
    throw new Error("relay_access_token_mismatch");
  }
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt ||
    issuedAt > now.getTime() + 10 * 60 * 1000 ||
    expiresAt < now.getTime() ||
    expiresAt - issuedAt > 31 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000
  ) {
    throw new Error("relay_access_token_expired_or_invalid");
  }
  if (
    (expected.institutionId && expected.institutionId !== institutionId) ||
    (expected.actorProfileId && expected.actorProfileId !== actorProfileId)
  ) {
    throw new Error("relay_access_token_mismatch");
  }

  const actor = db.prepare(`
    SELECT p.id
    FROM profiles p
    JOIN user_roles r
      ON r.institution_id = p.institution_id
     AND r.profile_id = p.id
     AND r.deleted_at IS NULL
    WHERE p.id = ?
      AND p.institution_id = ?
      AND p.deleted_at IS NULL
      AND p.is_active = 1
      AND r.role = 'teacher'
    LIMIT 1
  `).get(actorProfileId, institutionId) as { id: string } | undefined;
  if (!actor) throw new Error("teacher_not_paired_with_relay");

  return {
    institution_id: institutionId,
    actor_profile_id: actorProfileId,
  };
}
