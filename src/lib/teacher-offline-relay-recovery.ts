"use client";

import {
  listTeacherAttendanceOperations,
  retryTeacherAttendanceOperationOnRelay,
  type TeacherAttendanceDeliveryRecord,
} from "@/lib/teacher-attendance-delivery";
import {
  listTeacherSessionLifecycleOperations,
  retryTeacherSessionLifecycleOperationOnRelay,
  type TeacherSessionLifecycleDeliveryRecord,
} from "@/lib/teacher-session-lifecycle-delivery";
import {
  listTeacherSessionOpenOperations,
  retryTeacherSessionOpenOperationOnRelay,
  type TeacherSessionDeliveryRecord,
} from "@/lib/teacher-session-delivery";
import { registerOfflineSessionReference } from "@/lib/offline";

export type TeacherOfflineRelayRecoveryContext = {
  institutionId: string;
  actorProfileId: string;
  relayBaseUrl?: string | null;
  relayAccessToken?: string | null;
  /**
   * Une ouverture abandonnée ne doit jamais démarrer plus tard à l'insu du
   * professeur. Une séance encore affichée, ou une séance déjà terminée qui
   * possède des présences/une fermeture dépendantes, peut en revanche être
   * reconstruite automatiquement avec son contexte historique vérifié.
   */
  activeLocalSessionIds?: string[];
};

export type TeacherOfflineRelayRecoveredSession = {
  source: "open" | "transition";
  operation_id: string;
  attempt_key: string;
  class_id: string;
  period_id: string;
  session: Record<string, any>;
};

export type TeacherOfflineRelayRecoverySummary = {
  pending_before: number;
  pending_after: number;
  opens_retried: number;
  opens_confirmed: number;
  opens_waiting_for_user: number;
  attendance_retried: number;
  attendance_secured: number;
  lifecycle_retried: number;
  lifecycle_confirmed: number;
  closes_waiting_for_attendance: number;
  transitions_waiting_for_attendance: number;
  requires_attention: number;
  relay_unreachable: boolean;
  recovered_sessions: TeacherOfflineRelayRecoveredSession[];
};

export type TeacherOfflineRelayRecoveryDependencies = {
  listOpen(institutionId: string): Promise<TeacherSessionDeliveryRecord[]>;
  retryOpen(
    record: TeacherSessionDeliveryRecord,
    context: TeacherOfflineRelayRecoveryContext,
  ): Promise<TeacherSessionDeliveryRecord>;
  afterOpenRecovered?(
    record: TeacherSessionDeliveryRecord,
    context: TeacherOfflineRelayRecoveryContext,
  ): Promise<void>;
  listAttendance(institutionId: string): Promise<TeacherAttendanceDeliveryRecord[]>;
  retryAttendance(
    record: TeacherAttendanceDeliveryRecord,
    context: TeacherOfflineRelayRecoveryContext,
  ): Promise<TeacherAttendanceDeliveryRecord>;
  listLifecycle(
    institutionId: string,
  ): Promise<TeacherSessionLifecycleDeliveryRecord[]>;
  retryLifecycle(
    record: TeacherSessionLifecycleDeliveryRecord,
    context: TeacherOfflineRelayRecoveryContext,
  ): Promise<TeacherSessionLifecycleDeliveryRecord>;
};

function normalizedText(value: unknown) {
  return String(value || "").trim();
}

function sorted<T extends { created_at: string; operation_id: string }>(records: T[]) {
  return [...records].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.operation_id.localeCompare(right.operation_id),
  );
}

function attendanceResolved(record: TeacherAttendanceDeliveryRecord) {
  return record.state === "relay_secured" || record.state === "cloud_synced";
}

function attendanceRetryable(record: TeacherAttendanceDeliveryRecord) {
  if (record.channel === "cloud" || record.cloud_attempted_at) return false;
  return (
    record.state === "device_pending" ||
    (record.state === "blocked" && record.last_error === "session_not_found")
  );
}

function attendanceNeedsAttention(record: TeacherAttendanceDeliveryRecord) {
  return !attendanceResolved(record) && !attendanceRetryable(record);
}

function lifecycleResolved(record: TeacherSessionLifecycleDeliveryRecord) {
  return record.state === "relay_confirmed";
}

function pendingCount(
  opens: TeacherSessionDeliveryRecord[],
  attendance: TeacherAttendanceDeliveryRecord[],
  lifecycle: TeacherSessionLifecycleDeliveryRecord[],
) {
  return (
    opens.filter((record) => record.state === "device_pending").length +
    attendance.filter((record) => !attendanceResolved(record)).length +
    lifecycle.filter((record) => !lifecycleResolved(record)).length
  );
}

function attendanceMatchesSession(
  attendance: TeacherAttendanceDeliveryRecord,
  sessionId: string,
) {
  return (
    attendance.session_id === sessionId ||
    attendance.session_reference === sessionId
  );
}

function attendanceReadyForClose(
  record: TeacherSessionLifecycleDeliveryRecord,
  attendance: TeacherAttendanceDeliveryRecord[],
) {
  const dependency = record.attendance_operation_id
    ? attendance.find(
        (candidate) => candidate.operation_id === record.attendance_operation_id,
      ) || null
    : null;
  if (dependency) return attendanceResolved(dependency);
  if (!record.session_id) return true;
  const related = attendance.filter((candidate) =>
    attendanceMatchesSession(candidate, record.session_id!),
  );
  return related.length === 0 || related.every(attendanceResolved);
}

function attendanceReadyForTransition(
  record: TeacherSessionLifecycleDeliveryRecord,
  attendance: TeacherAttendanceDeliveryRecord[],
) {
  if (!record.class_id) return false;
  const latestBeforeTransition = sorted(
    attendance.filter(
      (candidate) =>
        candidate.class_id === record.class_id &&
        candidate.created_at <= record.created_at,
    ),
  ).at(-1);
  return !latestBeforeTransition || attendanceResolved(latestBeforeTransition);
}

function relayFailure(record: {
  last_status: number | null;
  last_error: string | null;
}) {
  return (
    record.last_status === 0 ||
    record.last_error === "relay_unreachable" ||
    record.last_error === "relay_presence_proof_unavailable"
  );
}

function activeOpenAttemptKeys(context: TeacherOfflineRelayRecoveryContext) {
  const keys = new Set<string>();
  for (const value of context.activeLocalSessionIds || []) {
    const normalized = normalizedText(value);
    if (!normalized) continue;
    keys.add(normalized);
    keys.add(normalized.startsWith("client:") ? normalized.slice(7) : normalized);
  }
  return keys;
}

function isActiveOpen(
  record: TeacherSessionDeliveryRecord,
  activeKeys: Set<string>,
) {
  return (
    activeKeys.has(record.attempt_key) ||
    activeKeys.has(`client:${record.attempt_key}`) ||
    activeKeys.has(record.operation_id) ||
    activeKeys.has(`client:${record.operation_id}`)
  );
}

function openRequiredByPendingWork(
  record: TeacherSessionDeliveryRecord,
  attendance: TeacherAttendanceDeliveryRecord[],
  lifecycle: TeacherSessionLifecycleDeliveryRecord[],
) {
  const sessionReferences = new Set([
    record.operation_id,
    `client:${record.operation_id}`,
    record.attempt_key,
    `client:${record.attempt_key}`,
  ]);
  const hasPendingAttendance = attendance.some(
    (candidate) =>
      !attendanceResolved(candidate) &&
      (sessionReferences.has(candidate.session_id) ||
        sessionReferences.has(candidate.session_reference)),
  );
  const hasPendingClose = lifecycle.some(
    (candidate) =>
      candidate.kind === "close" &&
      !lifecycleResolved(candidate) &&
      Boolean(candidate.session_id && sessionReferences.has(candidate.session_id)),
  );
  return hasPendingAttendance || hasPendingClose;
}

export async function recoverTeacherOfflineOperationsToRelayWithDependencies(
  context: TeacherOfflineRelayRecoveryContext,
  deps: TeacherOfflineRelayRecoveryDependencies,
): Promise<TeacherOfflineRelayRecoverySummary> {
  const institutionId = normalizedText(context.institutionId);
  const actorProfileId = normalizedText(context.actorProfileId);
  const relayBaseUrl = normalizedText(context.relayBaseUrl);
  const relayAccessToken = normalizedText(context.relayAccessToken);
  if (!institutionId) throw new Error("institution_id_required");
  if (!actorProfileId) throw new Error("actor_profile_id_required");

  let opens = await deps.listOpen(institutionId);
  let attendance = await deps.listAttendance(institutionId);
  let lifecycle = await deps.listLifecycle(institutionId);
  const pendingBefore = pendingCount(opens, attendance, lifecycle);
  const summary: TeacherOfflineRelayRecoverySummary = {
    pending_before: pendingBefore,
    pending_after: pendingBefore,
    opens_retried: 0,
    opens_confirmed: 0,
    opens_waiting_for_user: 0,
    attendance_retried: 0,
    attendance_secured: 0,
    lifecycle_retried: 0,
    lifecycle_confirmed: 0,
    closes_waiting_for_attendance: 0,
    transitions_waiting_for_attendance: 0,
    requires_attention: 0,
    relay_unreachable: false,
    recovered_sessions: [],
  };

  if (!relayBaseUrl || !relayAccessToken) {
    summary.relay_unreachable = pendingBefore > 0;
    return summary;
  }

  const activeKeys = activeOpenAttemptKeys(context);
  for (const record of sorted(
    opens.filter((candidate) => candidate.state === "device_pending"),
  )) {
    if (
      !isActiveOpen(record, activeKeys) &&
      !openRequiredByPendingWork(record, attendance, lifecycle)
    ) {
      summary.opens_waiting_for_user += 1;
      continue;
    }
    summary.opens_retried += 1;
    const next = await deps.retryOpen(record, {
      ...context,
      institutionId,
      actorProfileId,
      relayBaseUrl,
      relayAccessToken,
    });
    if (next.state === "relay_opened" && next.session_id) {
      summary.opens_confirmed += 1;
      await deps.afterOpenRecovered?.(next, context);
      summary.recovered_sessions.push({
        source: "open",
        operation_id: next.operation_id,
        attempt_key: next.attempt_key,
        class_id: next.class_id,
        period_id: next.period_id,
        session: {
          id: next.session_id,
          class_id: next.class_id,
          period_id: next.period_id,
          subject_id: next.subject_id,
          started_at: next.started_at,
          actual_call_at: next.actual_call_at,
          scheduled_end_at: next.scheduled_end_at,
          grace_expires_at: next.grace_expires_at,
          session_state: next.session_state,
          relay_time: next.relay_time,
        },
      });
    } else if (next.state === "blocked") {
      summary.requires_attention += 1;
    } else if (relayFailure(next)) {
      summary.relay_unreachable = true;
    }
  }

  // Une ouverture récupérée peut créer le mapping client -> relais nécessaire
  // aux marques enregistrées sur le téléphone.
  opens = await deps.listOpen(institutionId);
  attendance = await deps.listAttendance(institutionId);
  lifecycle = await deps.listLifecycle(institutionId);

  const attendanceByOperation = new Map(
    attendance.map((record) => [record.operation_id, record]),
  );
  for (const record of sorted(attendance)) {
    if (!attendanceRetryable(record)) {
      if (attendanceNeedsAttention(record)) summary.requires_attention += 1;
      continue;
    }
    summary.attendance_retried += 1;
    const next = await deps.retryAttendance(record, {
      ...context,
      institutionId,
      actorProfileId,
      relayBaseUrl,
      relayAccessToken,
    });
    attendanceByOperation.set(next.operation_id, next);
    if (attendanceResolved(next)) summary.attendance_secured += 1;
    else if (attendanceNeedsAttention(next)) summary.requires_attention += 1;
    if (relayFailure(next)) summary.relay_unreachable = true;
  }

  const attendanceAfterRetry = Array.from(attendanceByOperation.values());
  const closes = sorted(
    lifecycle.filter((record) => record.kind === "close"),
  );
  const transitions = sorted(
    lifecycle.filter((record) => record.kind === "transition"),
  );

  for (const record of closes) {
    if (record.state === "relay_confirmed") continue;
    if (record.state === "blocked") {
      summary.requires_attention += 1;
      continue;
    }
    if (!attendanceReadyForClose(record, attendanceAfterRetry)) {
      summary.closes_waiting_for_attendance += 1;
      continue;
    }
    summary.lifecycle_retried += 1;
    const next = await deps.retryLifecycle(record, {
      ...context,
      institutionId,
      actorProfileId,
      relayBaseUrl,
      relayAccessToken,
    });
    if (next.state === "relay_confirmed") summary.lifecycle_confirmed += 1;
    else if (next.state === "blocked") summary.requires_attention += 1;
    else if (relayFailure(next)) summary.relay_unreachable = true;
  }

  // Les transitions sont jouées après les fermetures et seulement lorsque les
  // appels de la classe sont déjà protégés sur le relais ou dans le Cloud.
  for (const record of transitions) {
    if (record.state === "relay_confirmed") continue;
    if (record.state === "blocked") {
      summary.requires_attention += 1;
      continue;
    }
    if (!attendanceReadyForTransition(record, attendanceAfterRetry)) {
      summary.transitions_waiting_for_attendance += 1;
      continue;
    }
    summary.lifecycle_retried += 1;
    const next = await deps.retryLifecycle(record, {
      ...context,
      institutionId,
      actorProfileId,
      relayBaseUrl,
      relayAccessToken,
    });
    if (next.state === "relay_confirmed") {
      summary.lifecycle_confirmed += 1;
      if (next.new_session && next.class_id && next.period_id) {
        summary.recovered_sessions.push({
          source: "transition",
          operation_id: next.operation_id,
          attempt_key: next.attempt_key,
          class_id: next.class_id,
          period_id: next.period_id,
          session: next.new_session,
        });
      }
    } else if (next.state === "blocked") {
      summary.requires_attention += 1;
    } else if (relayFailure(next)) {
      summary.relay_unreachable = true;
    }
  }

  const [finalOpens, finalAttendance, finalLifecycle] = await Promise.all([
    deps.listOpen(institutionId),
    deps.listAttendance(institutionId),
    deps.listLifecycle(institutionId),
  ]);
  summary.pending_after = pendingCount(
    finalOpens,
    finalAttendance,
    finalLifecycle,
  );
  return summary;
}

function productionDependencies(): TeacherOfflineRelayRecoveryDependencies {
  return {
    listOpen: listTeacherSessionOpenOperations,
    retryOpen: async (record, context) =>
      await retryTeacherSessionOpenOperationOnRelay(record, {
        relayBaseUrl: context.relayBaseUrl,
        relayAccessToken: context.relayAccessToken,
      }),
    afterOpenRecovered: async (record) => {
      if (!record.session_id) return;
      await registerOfflineSessionReference(
        `client:${record.operation_id}`,
        record.session_id,
      );
    },
    listAttendance: listTeacherAttendanceOperations,
    retryAttendance: async (record, context) =>
      await retryTeacherAttendanceOperationOnRelay(record, {
        actorProfileId: context.actorProfileId,
        relayBaseUrl: context.relayBaseUrl,
        relayAccessToken: context.relayAccessToken,
      }),
    listLifecycle: listTeacherSessionLifecycleOperations,
    retryLifecycle: async (record, context) =>
      await retryTeacherSessionLifecycleOperationOnRelay(record, {
        relayBaseUrl: context.relayBaseUrl,
        relayAccessToken: context.relayAccessToken,
      }),
  };
}

let recoveryPromise: Promise<TeacherOfflineRelayRecoverySummary> | null = null;

export async function recoverTeacherOfflineOperationsToRelay(
  context: TeacherOfflineRelayRecoveryContext,
): Promise<TeacherOfflineRelayRecoverySummary> {
  if (recoveryPromise) return await recoveryPromise;
  const run = () =>
    recoverTeacherOfflineOperationsToRelayWithDependencies(
      context,
      productionDependencies(),
    );
  const locks = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & {
        locks?: {
          request<T>(name: string, callback: () => Promise<T>): Promise<T>;
        };
      }).locks;
  const currentRecovery: Promise<TeacherOfflineRelayRecoverySummary> = locks
    ? locks.request<TeacherOfflineRelayRecoverySummary>(
        "moncahier-teacher-relay-recovery",
        run,
      )
    : run();
  recoveryPromise = currentRecovery;
  try {
    return await currentRecovery;
  } finally {
    if (recoveryPromise === currentRecovery) {
      recoveryPromise = null;
    }
  }
}
