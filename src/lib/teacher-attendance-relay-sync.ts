"use client";

import {
  cacheGet,
  registerOfflineSessionReference,
  resolveOfflineSessionReference,
} from "@/lib/offline";
import { getOfflineAccessIntent } from "@/lib/offline-auth-client";
import {
  CLASS_DEVICE_COHERENT_BUNDLE_KEY,
  validateClassDeviceRelayAccessTokenScope,
  type ClassDeviceCoherentBundle,
  type ClassDeviceReadinessLike,
  type ClassDeviceScheduleScope,
} from "@/lib/offlineClassDevice";
import { preferredRelayBaseUrl } from "@/lib/local-relay";
import { relayEnabledForInstitution } from "@/lib/relay-capability";
import { recoverClassDeviceAttendance } from "@/lib/class-device-attendance-recovery";
import {
  listTeacherAttendanceOperations,
  retryTeacherAttendanceOperationOnRelay,
} from "@/lib/teacher-attendance-delivery";
import {
  listTeacherSessionOpenOperations,
  retryTeacherSessionOpenOperationOnRelay,
} from "@/lib/teacher-session-delivery";

type RelaySyncContext = {
  role: "teacher" | "class_device";
  institutionId: string;
  actorProfileId: string;
  relayBaseUrl: string;
  relayAccessToken: string;
  classId?: string;
};

type CachedClassDevice = {
  id?: string | null;
  institution_id?: string | null;
  actor_profile_id?: string | null;
  attendance_presence?: {
    enabled?: boolean;
    allow_local_relay?: boolean;
    relay_local_url?: string | null;
    relay_local_urls?: string[] | null;
    relay_access_token?: string | null;
    access_contract_version?: number | null;
    actor_kind?: string | null;
    authorized_class_id?: string | null;
    authorized_actor_profile_id?: string | null;
  } | null;
};

export type AttendanceRelaySyncResult = {
  openedOnRelay: number;
  attendanceSecured: number;
  remaining: number;
  conflicts: number;
};

function text(value: unknown) {
  return String(value || "").trim();
}

async function teacherRelayContext(institutionId: string): Promise<RelaySyncContext | null> {
  const basics = await cacheGet<any>("teacher:inst:basics").catch(() => null);
  if (text(basics?.institution_id) !== institutionId) return null;

  const actorProfileId = text(basics?.actor_profile_id);
  const relay = basics?.attendance_presence || {};
  const relayBaseUrl = preferredRelayBaseUrl({
    institutionId,
    baseUrl: relay?.relay_local_url,
    baseUrls: Array.isArray(relay?.relay_local_urls) ? relay.relay_local_urls : [],
  });
  const relayAccessToken = text(relay?.relay_access_token);

  if (
    !actorProfileId ||
    relay?.enabled !== true ||
    relay?.allow_local_relay === false ||
    !relayBaseUrl ||
    !relayAccessToken
  ) {
    return null;
  }

  return {
    role: "teacher",
    institutionId,
    actorProfileId,
    relayBaseUrl,
    relayAccessToken,
  };
}

async function classDeviceRelayContext(
  institutionId: string,
): Promise<RelaySyncContext | null> {
  const bundle = await cacheGet<
    ClassDeviceCoherentBundle<ClassDeviceReadinessLike, ClassDeviceScheduleScope>
  >(CLASS_DEVICE_COHERENT_BUNDLE_KEY).catch(() => null);
  const readiness = bundle?.schema_version === 1 ? bundle.readiness : null;
  if (text(readiness?.institution_id) !== institutionId) return null;

  const classId = text(readiness?.authorized_class_id);
  const actorProfileId = text(readiness?.authorized_actor_profile_id);
  if (!classId || !actorProfileId) return null;

  const payload = await cacheGet<{ items?: CachedClassDevice[] }>(
    "classDevice:my-classes",
  ).catch(() => null);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const cached = items.find((item) =>
    text(item?.id) === classId &&
    text(item?.institution_id) === institutionId &&
    text(item?.actor_profile_id) === actorProfileId,
  );
  const relay = cached?.attendance_presence;
  if (
    !relay ||
    relay.enabled === false ||
    relay.allow_local_relay === false ||
    relay.access_contract_version !== 2 ||
    relay.actor_kind !== "class_device" ||
    text(relay.authorized_class_id) !== classId ||
    text(relay.authorized_actor_profile_id) !== actorProfileId
  ) {
    return null;
  }

  const relayAccessToken = text(relay.relay_access_token);
  const tokenScope = validateClassDeviceRelayAccessTokenScope(relayAccessToken, {
    institutionId,
    classId,
    actorProfileId,
  });
  if (!tokenScope.ok) return null;

  const relayBaseUrl = preferredRelayBaseUrl({
    institutionId,
    baseUrl: relay.relay_local_url,
    baseUrls: Array.isArray(relay.relay_local_urls) ? relay.relay_local_urls : [],
  });
  if (!relayBaseUrl || !relayAccessToken) return null;

  return {
    role: "class_device",
    institutionId,
    actorProfileId,
    relayBaseUrl,
    relayAccessToken,
    classId,
  };
}

async function activeRelayContext(): Promise<RelaySyncContext | null> {
  const intent = await getOfflineAccessIntent().catch(() => null);
  const institutionId = text(intent?.payload?.institution_id);
  const role = text(intent?.payload?.role);
  if (!institutionId || !relayEnabledForInstitution(institutionId)) return null;

  if (role === "teacher") return await teacherRelayContext(institutionId);
  if (role === "class_device" || role === "class-device") {
    return await classDeviceRelayContext(institutionId);
  }
  return null;
}

function teacherClientSessionReference(attemptKey: string) {
  const key = text(attemptKey);
  return key ? `client:${key}` : "";
}

async function syncTeacherOperationsToRelay(
  context: RelaySyncContext,
): Promise<AttendanceRelaySyncResult> {
  let openedOnRelay = 0;
  let attendanceSecured = 0;
  let conflicts = 0;

  const sessions = await listTeacherSessionOpenOperations(context.institutionId);
  for (const original of sessions) {
    let current = original;
    if (current.state === "device_pending") {
      current = await retryTeacherSessionOpenOperationOnRelay(current, {
        relayBaseUrl: context.relayBaseUrl,
        relayAccessToken: context.relayAccessToken,
      });
    }
    if (current.state !== "relay_opened" || !text(current.session_id)) continue;

    const clientReference = teacherClientSessionReference(current.attempt_key);
    if (!clientReference) continue;
    const existing = await resolveOfflineSessionReference(clientReference);
    if (existing.serverSessionId && existing.serverSessionId !== current.session_id) {
      conflicts += 1;
      continue;
    }
    if (!existing.serverSessionId) {
      try {
        await registerOfflineSessionReference(clientReference, current.session_id as string);
        openedOnRelay += 1;
      } catch {
        conflicts += 1;
      }
    }
  }

  const attendance = await listTeacherAttendanceOperations(context.institutionId);
  for (const original of attendance) {
    const retryable =
      original.state === "device_pending" ||
      (original.state === "blocked" && original.last_error === "session_not_found");
    if (!retryable || original.channel === "cloud" || original.cloud_attempted_at) continue;

    const mapped = await resolveOfflineSessionReference(original.session_reference);
    if (!mapped.serverSessionId) continue;

    const next = await retryTeacherAttendanceOperationOnRelay(original, {
      actorProfileId: context.actorProfileId,
      relayBaseUrl: context.relayBaseUrl,
      relayAccessToken: context.relayAccessToken,
    });
    if (next.state === "relay_secured" || next.state === "cloud_synced") {
      attendanceSecured += 1;
    } else if (next.state === "conflict") {
      conflicts += 1;
    }
  }

  const [sessionAfter, attendanceAfter] = await Promise.all([
    listTeacherSessionOpenOperations(context.institutionId),
    listTeacherAttendanceOperations(context.institutionId),
  ]);
  const remainingSessions = sessionAfter.filter((record) => record.state === "device_pending").length;
  const remainingAttendance = attendanceAfter.filter((record) =>
    record.state !== "relay_secured" &&
    record.state !== "cloud_synced" &&
    record.state !== "superseded",
  ).length;

  return {
    openedOnRelay,
    attendanceSecured,
    remaining: remainingSessions + remainingAttendance,
    conflicts,
  };
}

/**
 * Reprend les séances/appels restés sur l'appareil dès que le Relais local
 * redevient joignable, même si Internet est toujours absent.
 *
 * Professeur : matérialise la séance, enregistre le mapping client:* -> UUID
 * Relais puis rejoue les marques avec leurs operation_id d'origine.
 *
 * Téléphone de classe : délègue au moteur de récupération déjà dédié à ce
 * profil, qui reprend dans l'ordre ouverture -> appel -> fermeture et conserve
 * ses identifiants `client:${open_operation_id}` historiques.
 *
 * La capacité Relais est fail-closed : une école Cloud-only n'entre jamais ici.
 */
export async function syncDurableAttendanceOperationsToRelay(): Promise<AttendanceRelaySyncResult> {
  const context = await activeRelayContext();
  if (!context) {
    return { openedOnRelay: 0, attendanceSecured: 0, remaining: 0, conflicts: 0 };
  }

  if (context.role === "class_device") {
    const classId = text(context.classId);
    if (!classId) {
      return { openedOnRelay: 0, attendanceSecured: 0, remaining: 0, conflicts: 1 };
    }
    const summary = await recoverClassDeviceAttendance({
      institutionId: context.institutionId,
      classId,
      actorProfileId: context.actorProfileId,
      relayBaseUrl: context.relayBaseUrl,
      relayAccessToken: context.relayAccessToken,
    });
    return {
      openedOnRelay: summary.opens_confirmed,
      attendanceSecured: summary.attendance_secured,
      remaining: summary.pending_after,
      conflicts: summary.requires_attention,
    };
  }

  return await syncTeacherOperationsToRelay(context);
}
