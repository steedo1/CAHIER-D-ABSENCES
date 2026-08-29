"use client";

import { resolveOfflineSessionReference } from "@/lib/offline";
import {
  createIndexedDbTeacherAttendanceStore,
  type TeacherAttendanceDeliveryRecord,
} from "@/lib/teacher-attendance-delivery";

export type TeacherAttendanceCloudSyncResult = {
  flushed: number;
  remaining: number;
  blocked: number;
  authRequired: boolean;
};

function text(value: unknown) {
  return String(value || "").trim();
}

function retryable(record: TeacherAttendanceDeliveryRecord) {
  return record.state === "device_pending" ||
    record.state === "delivery_unknown" ||
    record.state === "relay_secured" ||
    (record.state === "blocked" && record.last_error === "session_not_found");
}

async function json(response: Response) {
  try {
    const value = await response.json();
    return value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

async function cloudAvailable() {
  if (typeof navigator === "undefined" || navigator.onLine === false) return false;
  try {
    const response = await fetch("/api/auth/role", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Rejoue vers le Cloud les appels durablement conservés dans IndexedDB.
 *
 * L'ouverture/fermeture de séance de l'ancienne outbox doit être rejouée avant
 * cette fonction afin que les identifiants `client:*` aient déjà leur mapping
 * serveur. Chaque appel conserve son operation_id original : le POST Cloud est
 * donc idempotent même après plusieurs retours réseau ou redémarrages du PWA.
 */
export async function syncTeacherAttendanceOperationsToCloud(
  institutionId: string | null | undefined,
): Promise<TeacherAttendanceCloudSyncResult> {
  const normalizedInstitutionId = text(institutionId);
  if (!normalizedInstitutionId) {
    return { flushed: 0, remaining: 0, blocked: 0, authRequired: false };
  }

  const store = createIndexedDbTeacherAttendanceStore();
  const before = await store.list(normalizedInstitutionId);
  const unresolvedBefore = before.filter(
    (record) => record.state !== "cloud_synced" && record.state !== "superseded",
  );

  if (!(await cloudAvailable())) {
    return {
      flushed: 0,
      remaining: unresolvedBefore.length,
      blocked: unresolvedBefore.filter(
        (record) => record.state === "blocked" || record.state === "conflict",
      ).length,
      authRequired: unresolvedBefore.some((record) => record.requires_authentication),
    };
  }

  let flushed = 0;
  let blocked = 0;
  let authRequired = false;

  for (const original of unresolvedBefore) {
    if (!retryable(original)) {
      if (original.state === "blocked" || original.state === "conflict") blocked += 1;
      if (original.requires_authentication) authRequired = true;
      continue;
    }

    const resolved = await resolveOfflineSessionReference(original.session_reference);
    if (!resolved.serverSessionId) {
      // La création de séance est encore dans l'outbox. On ne perd rien : le
      // prochain réveil online retentera après le rejeu de cette outbox.
      continue;
    }

    const attemptedAt = new Date().toISOString();
    const current: TeacherAttendanceDeliveryRecord = {
      ...original,
      session_id: resolved.serverSessionId,
      channel: "cloud",
      cloud_attempted_at: attemptedAt,
      updated_at: attemptedAt,
      last_status: null,
      last_error: "cloud_replay_in_progress",
      requires_authentication: false,
      captured_at_device: original.captured_at_device || original.created_at,
    };
    await store.put(current);

    let response: Response;
    let body: Record<string, unknown> = {};
    try {
      response = await fetch("/api/teacher/attendance/bulk", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Mon-Cahier-Operation-Id": current.operation_id,
        },
        body: JSON.stringify({
          session_id: current.session_id,
          captured_at_device: current.captured_at_device,
          marks: current.marks.map((mark) => ({
            student_id: mark.student_id,
            status: mark.status,
            reason: mark.comment,
            observed_at: mark.observed_at,
          })),
        }),
      });
      body = await json(response);
    } catch {
      await store.put({
        ...current,
        state: "delivery_unknown",
        updated_at: new Date().toISOString(),
        last_status: 0,
        last_error: "cloud_delivery_unknown",
      });
      continue;
    }

    const responseOperationId = text(body.operation_id);
    if (response.ok && responseOperationId === current.operation_id) {
      await store.put({
        ...current,
        state: "cloud_synced",
        updated_at: new Date().toISOString(),
        last_status: response.status,
        last_error: null,
        requires_authentication: false,
      });
      flushed += 1;
      continue;
    }

    if (response.ok) {
      await store.put({
        ...current,
        state: "conflict",
        updated_at: new Date().toISOString(),
        last_status: response.status,
        last_error: "cloud_operation_id_mismatch",
      });
      blocked += 1;
      continue;
    }

    const error = text(body.error || body.message) || `cloud_http_${response.status}`;
    if (response.status === 401) {
      await store.put({
        ...current,
        state: "device_pending",
        updated_at: new Date().toISOString(),
        last_status: response.status,
        last_error: "authentication_required",
        requires_authentication: true,
      });
      authRequired = true;
      break;
    }

    if (response.status === 409) {
      await store.put({
        ...current,
        state: "conflict",
        updated_at: new Date().toISOString(),
        last_status: response.status,
        last_error: error,
      });
      blocked += 1;
      continue;
    }

    if ([400, 403, 404, 422].includes(response.status)) {
      await store.put({
        ...current,
        state: "blocked",
        updated_at: new Date().toISOString(),
        last_status: response.status,
        last_error: error,
      });
      blocked += 1;
      continue;
    }

    await store.put({
      ...current,
      state: "delivery_unknown",
      updated_at: new Date().toISOString(),
      last_status: response.status,
      last_error: "cloud_delivery_unknown",
    });
  }

  const after = await store.list(normalizedInstitutionId);
  const unresolvedAfter = after.filter(
    (record) => record.state !== "cloud_synced" && record.state !== "superseded",
  );

  return {
    flushed,
    remaining: unresolvedAfter.length,
    blocked: Math.max(
      blocked,
      unresolvedAfter.filter(
        (record) => record.state === "blocked" || record.state === "conflict",
      ).length,
    ),
    authRequired: authRequired || unresolvedAfter.some((record) => record.requires_authentication),
  };
}
