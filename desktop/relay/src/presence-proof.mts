import { createHmac, timingSafeEqual } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { canonicalJson, parseStoredJson } from "./json.mjs";
import {
  authenticateRelayTeacherAccess,
  relayActorClassId,
  relayActorKind,
  type AuthenticatedRelayTeacher,
} from "./teacher-auth.mjs";

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

type RelayPresenceProofPayload = {
  v: 1;
  institution_id: string;
  actor_profile_id: string;
  client_session_id: string;
  issued_at: string;
  expires_at: string;
  source: "local_relay";
};

export class RelayPresenceProofError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function required(value: unknown, name: string, maxLength = 256) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name}_required`);
  if (text.length > maxLength) throw new Error(`${name}_too_long`);
  return text;
}

export function verifyAttendancePresenceProof(
  db: RelayDatabase,
  token: string,
  expected: {
    institutionId: string;
    actorProfileId: string;
    clientSessionId: string;
  },
  now = new Date(),
) {
  const normalized = String(token || "").trim();
  if (!normalized || normalized.length > 4096) {
    throw new RelayPresenceProofError("relay_proof_invalid");
  }
  const [encodedPayload, encodedSignature, extra] = normalized.split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    throw new RelayPresenceProofError("relay_proof_invalid");
  }

  const institution = db.prepare(`
    SELECT settings_json FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(expected.institutionId) as { settings_json: string | null } | undefined;
  if (!institution) throw new RelayPresenceProofError("institution_not_initialized");
  const settings = parseStoredJson<Record<string, unknown>>(institution.settings_json) || {};
  const attendance = (
    settings.attendance_presence && typeof settings.attendance_presence === "object"
      ? settings.attendance_presence
      : {}
  ) as RelayAttendanceSettings;
  if (attendance.enabled !== true) {
    throw new RelayPresenceProofError("attendance_presence_not_required");
  }
  if (attendance.allow_local_relay === false) {
    throw new RelayPresenceProofError("relay_presence_disabled");
  }
  const secret = String(attendance.relay_presence_secret || "").trim();
  if (secret.length < 32) throw new RelayPresenceProofError("relay_presence_secret_missing");

  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest();
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new RelayPresenceProofError("relay_proof_invalid");
  }
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new RelayPresenceProofError("relay_proof_invalid");
  }

  let payload: RelayPresenceProofPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as RelayPresenceProofPayload;
  } catch {
    throw new RelayPresenceProofError("relay_proof_invalid");
  }
  if (
    payload.v !== 1 ||
    payload.source !== "local_relay" ||
    payload.institution_id !== expected.institutionId ||
    payload.actor_profile_id !== expected.actorProfileId ||
    payload.client_session_id !== expected.clientSessionId
  ) {
    throw new RelayPresenceProofError("relay_proof_mismatch");
  }

  const issuedAt = new Date(payload.issued_at).getTime();
  const expiresAt = new Date(payload.expires_at).getTime();
  const configuredTtlMs = Math.min(
    600_000,
    Math.max(30_000, Math.round(Number(attendance.relay_proof_ttl_seconds || 180)) * 1000),
  );
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new RelayPresenceProofError("relay_proof_time_invalid");
  }
  if (issuedAt > now.getTime() + 10 * 60_000) {
    throw new RelayPresenceProofError("relay_proof_time_invalid");
  }
  if (expiresAt < now.getTime()) throw new RelayPresenceProofError("relay_proof_expired");
  if (expiresAt - issuedAt > configuredTtlMs + 5_000) {
    throw new RelayPresenceProofError("relay_proof_ttl_invalid");
  }
  return payload;
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

  const actor = authenticateRelayTeacherAccess(db, accessToken, now, {
    institutionId,
  });
  if (actor.actor_profile_id !== actorProfileId) {
    throw new Error("relay_access_token_mismatch");
  }

  if (relayActorKind(actor) === "teacher") {
    return issueAttendancePresenceProofForTeacher(db, actor, clientSessionId, now);
  }

  const session = db.prepare(`
    SELECT id, client_session_id, class_id, teacher_id
    FROM teacher_sessions
    WHERE institution_id = ?
      AND (id = ? OR client_session_id = ?)
      AND deleted_at IS NULL
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(
    institutionId,
    clientSessionId,
    clientSessionId,
    clientSessionId,
  ) as {
    id: string;
    client_session_id: string | null;
    class_id: string;
    teacher_id: string;
  } | undefined;
  if (!session) throw new Error("session_not_found");
  if (session.class_id !== relayActorClassId(actor)) {
    throw new Error("class_device_class_mismatch");
  }
  return issueAttendancePresenceProofForTeacher(
    db,
    { institution_id: institutionId, actor_profile_id: session.teacher_id },
    session.client_session_id || session.id,
    now,
  );
}

export function issueAttendancePresenceProofForTeacher(
  db: RelayDatabase,
  teacher: AuthenticatedRelayTeacher,
  clientSessionId: string,
  now = new Date(),
) {
  const institutionId = required(teacher.institution_id, "institution_id");
  const actorProfileId = required(teacher.actor_profile_id, "actor_profile_id");
  const normalizedClientSessionId = required(clientSessionId, "client_session_id");
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

  const ttlSeconds = Math.min(600, Math.max(30, Math.round(Number(attendance.relay_proof_ttl_seconds || 180))));
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const payload = {
    v: 1 as const,
    institution_id: institutionId,
    actor_profile_id: actorProfileId,
    client_session_id: normalizedClientSessionId,
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
    canonicalJson({ client_session_id: normalizedClientSessionId, expires_at: expiresAt }),
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
