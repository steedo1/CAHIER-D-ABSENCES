import { createHmac } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { canonicalJson, parseStoredJson } from "./json.mjs";
import { authenticateRelayTeacherAccess } from "./teacher-auth.mjs";

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

function required(value: unknown, name: string, maxLength = 256) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name}_required`);
  if (text.length > maxLength) throw new Error(`${name}_too_long`);
  return text;
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

  authenticateRelayTeacherAccess(db, accessToken, now, {
    institutionId,
    actorProfileId,
  });

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
