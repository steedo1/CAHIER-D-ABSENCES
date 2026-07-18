import { createHmac, timingSafeEqual } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { canonicalJson, parseStoredJson } from "./json.mjs";

type PresenceProofInput = {
  institution_id?: unknown;
  actor_profile_id?: unknown;
  client_session_id?: unknown;
  access_token?: unknown;
};

type RelayAttendanceSettings = {
  enabled?: boolean;
  allow_local_relay?: boolean;
  relay_presence_secret?: string;
  relay_proof_ttl_seconds?: number;
};

type RelayAccessPayload = {
  v: 1;
  purpose: "attendance_relay_access";
  institution_id: string;
  actor_profile_id: string;
  issued_at: string;
  expires_at: string;
};

function required(value: unknown, name: string, maxLength = 256) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name}_required`);
  if (text.length > maxLength) throw new Error(`${name}_too_long`);
  return text;
}

function decodeAccessToken(token: string, secret: string): RelayAccessPayload {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("relay_access_token_invalid");
  const expected = createHmac("sha256", secret).update(encodedPayload).digest();
  const supplied = Buffer.from(encodedSignature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("relay_access_token_signature_invalid");
  }
  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as RelayAccessPayload;
  } catch {
    throw new Error("relay_access_token_payload_invalid");
  }
}

export function issueAttendancePresenceProof(
  db: RelayDatabase,
  raw: unknown,
  now = new Date(),
) {
  const input = (raw && typeof raw === "object" ? raw : {}) as PresenceProofInput;
  const institutionId = required(input.institution_id, "institution_id");
  const actorProfileId = required(input.actor_profile_id, "actor_profile_id");
  const clientSessionId = required(input.client_session_id, "client_session_id");
  const accessToken = required(input.access_token, "access_token", 2048);

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
  if (attendance.enabled !== true || attendance.allow_local_relay === false) {
    throw new Error("relay_attendance_presence_disabled");
  }
  const secret = String(attendance.relay_presence_secret || "").trim();
  if (secret.length < 32) throw new Error("relay_presence_secret_missing");

  const access = decodeAccessToken(accessToken, secret);
  const accessIssued = new Date(access.issued_at).getTime();
  const accessExpires = new Date(access.expires_at).getTime();
  if (
    access.v !== 1 ||
    access.purpose !== "attendance_relay_access" ||
    access.institution_id !== institutionId ||
    access.actor_profile_id !== actorProfileId
  ) {
    throw new Error("relay_access_token_mismatch");
  }
  if (
    !Number.isFinite(accessIssued) ||
    !Number.isFinite(accessExpires) ||
    accessExpires <= accessIssued ||
    accessIssued > now.getTime() + 10 * 60 * 1000 ||
    accessExpires < now.getTime() ||
    accessExpires - accessIssued > 31 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000
  ) {
    throw new Error("relay_access_token_expired_or_invalid");
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

  const ttlSeconds = Math.min(600, Math.max(30, Math.round(Number(attendance.relay_proof_ttl_seconds || 180))));
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const payload = {
    v: 1 as const,
    institution_id: institutionId,
    actor_profile_id: actorProfileId,
    client_session_id: clientSessionId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    source: "local_relay" as const,
  };
  const encodedPayload = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  db.prepare(`
    INSERT INTO audit_log(
      institution_id, actor_profile_id, event_type, details_json, occurred_at
    ) VALUES (?, ?, 'attendance.presence_proof_issued', ?, ?)
  `).run(
    institutionId,
    actorProfileId,
    canonicalJson({ client_session_id: clientSessionId, expires_at: expiresAt }),
    issuedAt,
  );

  return {
    ok: true,
    proof: `${encodedPayload}.${signature}`,
    issued_at: issuedAt,
    expires_at: expiresAt,
    method: "local_relay" as const,
  };
}
