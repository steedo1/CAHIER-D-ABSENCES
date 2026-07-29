import { createHmac, timingSafeEqual } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { parseStoredJson } from "./json.mjs";

export type RelayActorKind = "teacher" | "class_device";

type RelayAccessPayloadV1 = {
  v: 1;
  purpose: "attendance_relay_access";
  institution_id: string;
  actor_profile_id: string;
  issued_at: string;
  expires_at: string;
};

type RelayAccessPayloadV2 = {
  v: 2;
  purpose: "attendance_relay_access";
  institution_id: string;
  actor_profile_id: string;
  actor_kind: RelayActorKind;
  class_id?: string | null;
  issued_at: string;
  expires_at: string;
};

type RelayAccessPayload = RelayAccessPayloadV1 | RelayAccessPayloadV2;

type RelayAttendanceSettings = {
  relay_presence_secret?: string;
};

export type AuthenticatedRelayTeacher = {
  institution_id: string;
  actor_profile_id: string;
  /** Optional for source compatibility with existing relay callers/tests. */
  actor_kind?: RelayActorKind;
  /** Required only when actor_kind is class_device. */
  class_id?: string | null;
};

export function relayActorKind(actor: AuthenticatedRelayTeacher): RelayActorKind {
  return actor.actor_kind === "class_device" ? "class_device" : "teacher";
}

export function relayActorClassId(actor: AuthenticatedRelayTeacher): string | null {
  return relayActorKind(actor) === "class_device"
    ? String(actor.class_id || "").trim() || null
    : null;
}

export function relayActorDeviceId(actor: AuthenticatedRelayTeacher): string {
  const kind = relayActorKind(actor);
  if (kind === "class_device") {
    return `class_device:${relayActorClassId(actor) || actor.actor_profile_id}`;
  }
  return `teacher:${actor.actor_profile_id}`;
}

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

function optionalClaim(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return null;
  return requiredClaim(value, name);
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
  const actorKind: RelayActorKind = parsed.payload.v === 2
    ? parsed.payload.actor_kind
    : "teacher";
  if (actorKind !== "teacher" && actorKind !== "class_device") {
    throw new Error("relay_access_token_actor_kind_invalid");
  }
  const classId = parsed.payload.v === 2
    ? optionalClaim(parsed.payload.class_id, "class_id")
    : null;
  if (actorKind === "class_device" && !classId) {
    throw new Error("relay_access_token_class_required");
  }
  if (actorKind === "teacher" && classId) {
    throw new Error("relay_access_token_class_not_allowed");
  }

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
    (parsed.payload.v !== 1 && parsed.payload.v !== 2) ||
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

  if (actorKind === "teacher") {
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
  } else {
    const boundClass = db.prepare(`
      SELECT id FROM classes
      WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(institutionId, classId) as { id: string } | undefined;
    if (!boundClass) throw new Error("class_device_not_paired_with_relay");
  }

  return {
    institution_id: institutionId,
    actor_profile_id: actorProfileId,
    actor_kind: actorKind,
    class_id: classId,
  };
}
