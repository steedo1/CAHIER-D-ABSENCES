"use client";

import { cacheGet, resolveOfflineSessionReference } from "@/lib/offline";
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

const STORE_INSTITUTIONS_KEY = "teacher:attendance-delivery:v1:institutions";

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

async function knownInstitutionIds(preferred?: string | null) {
  const indexed = await cacheGet<string[]>(STORE_INSTITUTIONS_KEY).catch(() => []);
  const teacherInstitution = text(
    await cacheGet<any>("teacher:inst:basics")
      .then((value) => value?.institution_id)
      .catch(() => ""),
  );
  return Array.from(new Set(
    [preferred, teacherInstitution, ...(indexed || [])]
      .map(text)
      .filter(Boolean),
  ));
}

async function syncOneInstitution(
  normalizedInstitutionId: string,
): Promise<TeacherAttendanceCloudSyncResult> {
  const store = createIndexedDbTeacherAttendanceStore();
  const before = await store.list(normalizedInstitutionId);
  const unresolvedBefore = before.filter(
    (record) => record.state !== "cloud_synced" && record.state !== "superseded",
  );

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
      // La création de séance est encore dans l'outbox. Le prochain réveil
      // online retentera après son rejeu, sans supprimer les marques locales.
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

/**
 * Rejoue vers le Cloud les appels durablement conservés dans IndexedDB.
 *
 * L'ancienne outbox est rejouée par OfflineSyncBar. Les appels utilisent ensuite
 * le mapping de séance créé par cette outbox et conservent leur operation_id
 * original : les répétitions sont idempotentes après retour réseau, changement
 * de page ou redémarrage du PWA.
 */
export async function syncTeacherAttendanceOperationsToCloud(
  institutionId?: string | null,
): Promise<TeacherAttendanceCloudSyncResult> {
  const institutionIds = await knownInstitutionIds(institutionId);
  if (institutionIds.length === 0) {
    return { flushed: 0, remaining: 0, blocked: 0, authRequired: false };
  }

  if (!(await cloudAvailable())) {
    const store = createIndexedDbTeacherAttendanceStore();
    const records = (await Promise.all(
      institutionIds.map((id) => store.list(id)),
    )).flat().filter(
      (record) => record.state !== "cloud_synced" && record.state !== "superseded",
    );
    return {
      flushed: 0,
      remaining: records.length,
      blocked: records.filter(
        (record) => record.state === "blocked" || record.state === "conflict",
      ).length,
      authRequired: records.some((record) => record.requires_authentication),
    };
  }

  const results = [] as TeacherAttendanceCloudSyncResult[];
  for (const id of institutionIds) {
    results.push(await syncOneInstitution(id));
  }

  return results.reduce<TeacherAttendanceCloudSyncResult>(
    (total, item) => ({
      flushed: total.flushed + item.flushed,
      remaining: total.remaining + item.remaining,
      blocked: total.blocked + item.blocked,
      authRequired: total.authRequired || item.authRequired,
    }),
    { flushed: 0, remaining: 0, blocked: 0, authRequired: false },
  );
}
