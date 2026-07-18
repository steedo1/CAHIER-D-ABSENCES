import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { distanceMeters, type AttendancePresenceEvidence } from "./attendance-presence";

const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type RelayProofPayload = {
  v: 1;
  institution_id: string;
  actor_profile_id: string;
  client_session_id: string;
  issued_at: string;
  expires_at: string;
  source: "local_relay";
};

type RelayAccessPayload = {
  v: 1;
  purpose: "attendance_relay_access";
  institution_id: string;
  actor_profile_id: string;
  issued_at: string;
  expires_at: string;
};

export type PresenceVerification = {
  required: boolean;
  verified: true;
  method: "gps" | "local_relay" | "not_required";
  checked_at: string;
  effective_call_at: string | null;
  zone_id: string | null;
  distance_m: number | null;
  accuracy_m: number | null;
};

export class PresenceVerificationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createRelayAttendanceAccessToken(input: {
  secret: string;
  institutionId: string;
  actorProfileId: string;
  now?: Date;
  ttlDays?: number;
}) {
  const now = input.now || new Date();
  const ttlDays = Math.min(31, Math.max(1, Math.round(input.ttlDays || 30)));
  const payload: RelayAccessPayload = {
    v: 1,
    purpose: "attendance_relay_access",
    institution_id: input.institutionId,
    actor_profile_id: input.actorProfileId,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", input.secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function decodeRelayProof(token: string, secret: string): RelayProofPayload {
  const [encodedPayload, encodedSignature, extra] = String(token || "").split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    throw new PresenceVerificationError(403, "relay_proof_invalid", "Preuve du relais invalide.");
  }
  const expected = createHmac("sha256", secret).update(encodedPayload).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new PresenceVerificationError(403, "relay_proof_invalid", "Preuve du relais invalide.");
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new PresenceVerificationError(403, "relay_proof_invalid", "Signature du relais invalide.");
  }
  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as RelayProofPayload;
  } catch {
    throw new PresenceVerificationError(403, "relay_proof_invalid", "Contenu de la preuve du relais invalide.");
  }
}

export async function verifyAttendancePresence(input: {
  service: SupabaseClient;
  institutionId: string;
  actorProfileId: string;
  clientSessionId: string;
  evidence: AttendancePresenceEvidence | null | undefined;
  now?: Date;
}): Promise<PresenceVerification> {
  const now = input.now || new Date();
  const checkedAt = now.toISOString();
  const { data: policy, error: policyError } = await input.service
    .from("institution_attendance_policies")
    .select(
      "enabled,teacher_accounts_only,allow_local_relay,allow_gps_fallback,max_gps_accuracy_m,gps_grace_m,relay_proof_ttl_seconds,relay_presence_secret",
    )
    .eq("institution_id", input.institutionId)
    .maybeSingle();

  if ((policyError as any)?.code === "42P01") {
    return {
      required: false,
      verified: true,
      method: "not_required",
      checked_at: checkedAt,
      effective_call_at: null,
      zone_id: null,
      distance_m: null,
      accuracy_m: null,
    };
  }
  if (policyError) {
    throw new PresenceVerificationError(500, "attendance_policy_unavailable", policyError.message);
  }
  if (!policy?.enabled) {
    return {
      required: false,
      verified: true,
      method: "not_required",
      checked_at: checkedAt,
      effective_call_at: null,
      zone_id: null,
      distance_m: null,
      accuracy_m: null,
    };
  }
  if (!input.evidence) {
    throw new PresenceVerificationError(
      428,
      "attendance_presence_required",
      "Présence dans l'établissement non confirmée. Utilisez le réseau local de l'école ou activez la localisation.",
    );
  }

  if (input.evidence.method === "local_relay") {
    if (!policy.allow_local_relay) {
      throw new PresenceVerificationError(403, "relay_presence_disabled", "La preuve par relais est désactivée.");
    }
    const payload = decodeRelayProof(input.evidence.proof, String(policy.relay_presence_secret || ""));
    if (
      payload.v !== 1 ||
      payload.source !== "local_relay" ||
      payload.institution_id !== input.institutionId ||
      payload.actor_profile_id !== input.actorProfileId ||
      payload.client_session_id !== input.clientSessionId
    ) {
      throw new PresenceVerificationError(403, "relay_proof_mismatch", "Cette preuve locale ne correspond pas à cet appel.");
    }
    const issued = new Date(payload.issued_at).getTime();
    const expires = new Date(payload.expires_at).getTime();
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) {
      throw new PresenceVerificationError(403, "relay_proof_time_invalid", "Horodatage de la preuve locale invalide.");
    }
    if (issued > now.getTime() + 10 * 60 * 1000 || issued < now.getTime() - OFFLINE_MAX_AGE_MS) {
      throw new PresenceVerificationError(403, "relay_proof_too_old", "La preuve locale est trop ancienne pour être synchronisée.");
    }
    const configuredTtl = Number(policy.relay_proof_ttl_seconds || 180) * 1000;
    if (expires - issued > configuredTtl + 5_000) {
      throw new PresenceVerificationError(403, "relay_proof_ttl_invalid", "Durée de validité de la preuve locale invalide.");
    }
    return {
      required: true,
      verified: true,
      method: "local_relay",
      checked_at: checkedAt,
      effective_call_at: new Date(issued).toISOString(),
      zone_id: null,
      distance_m: null,
      accuracy_m: null,
    };
  }

  if (!policy.allow_gps_fallback) {
    throw new PresenceVerificationError(403, "gps_presence_disabled", "Cet établissement exige le réseau local pour l'appel.");
  }

  const position = input.evidence.position;
  const latitude = finiteNumber(position?.latitude);
  const longitude = finiteNumber(position?.longitude);
  const accuracy = finiteNumber(position?.accuracy);
  const captured = new Date(String(position?.captured_at || "")).getTime();
  if (
    latitude === null ||
    longitude === null ||
    accuracy === null ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracy <= 0 ||
    !Number.isFinite(captured)
  ) {
    throw new PresenceVerificationError(422, "gps_evidence_invalid", "Informations GPS invalides.");
  }
  if (captured > now.getTime() + 10 * 60 * 1000 || captured < now.getTime() - OFFLINE_MAX_AGE_MS) {
    throw new PresenceVerificationError(422, "gps_evidence_too_old", "La position GPS est trop ancienne.");
  }
  if (accuracy > Number(policy.max_gps_accuracy_m || 60)) {
    throw new PresenceVerificationError(
      422,
      "gps_accuracy_insufficient",
      `Signal GPS trop imprécis (±${Math.round(accuracy)} m).`,
      { accuracy_m: Math.round(accuracy), max_accuracy_m: Number(policy.max_gps_accuracy_m || 60) },
    );
  }

  const { data: zones, error: zonesError } = await input.service
    .from("institution_attendance_zones")
    .select("id,name,latitude,longitude,radius_m")
    .eq("institution_id", input.institutionId)
    .eq("is_active", true);
  if (zonesError) {
    throw new PresenceVerificationError(500, "attendance_zones_unavailable", zonesError.message);
  }
  if (!zones?.length) {
    throw new PresenceVerificationError(409, "attendance_zones_missing", "Aucune zone d'appel n'est configurée.");
  }

  const nearest = zones
    .map((zone: any) => ({
      zone,
      distance: distanceMeters(latitude, longitude, Number(zone.latitude), Number(zone.longitude)),
    }))
    .sort((a: any, b: any) => a.distance - b.distance)[0];
  const grace = Math.min(Math.max(0, Number(policy.gps_grace_m || 0)), accuracy);
  if (nearest.distance > Number(nearest.zone.radius_m) + grace) {
    throw new PresenceVerificationError(
      403,
      "attendance_outside_geofence",
      `Appel refusé : vous êtes hors du périmètre autorisé (${Math.round(nearest.distance)} m de ${nearest.zone.name}).`,
      { distance_m: Math.round(nearest.distance), zone_name: nearest.zone.name },
    );
  }

  return {
    required: true,
    verified: true,
    method: "gps",
    checked_at: checkedAt,
    effective_call_at: new Date(captured).toISOString(),
    zone_id: String(nearest.zone.id),
    distance_m: Math.round(nearest.distance),
    accuracy_m: Math.round(accuracy),
  };
}
