"use client";

import {
  listTeacherAttendanceOperations,
  retryTeacherAttendanceOperationOnRelay,
  type TeacherAttendanceDeliveryRecord,
} from "@/lib/teacher-attendance-delivery";
import {
  listTeacherSessionLifecycleOperations,
  retryTeacherSessionCloseOnRelay,
  type TeacherSessionLifecycleDeliveryRecord,
} from "@/lib/teacher-session-lifecycle-delivery";

export type ClassDeviceAttendanceRecoveryContext = {
  institutionId: string;
  classId: string;
  actorProfileId: string;
  relayBaseUrl?: string | null;
  relayAccessToken?: string | null;
};

export type ClassDeviceAttendanceRecoverySummary = {
  pending_before: number;
  pending_after: number;
  attendance_retried: number;
  attendance_secured: number;
  closes_retried: number;
  closes_confirmed: number;
  closes_waiting_for_attendance: number;
  requires_attention: number;
  relay_unreachable: boolean;
};

export type ClassDeviceAttendanceRecoveryDependencies = {
  listAttendance(
    institutionId: string,
  ): Promise<TeacherAttendanceDeliveryRecord[]>;
  retryAttendance(
    record: TeacherAttendanceDeliveryRecord,
    context: ClassDeviceAttendanceRecoveryContext,
  ): Promise<TeacherAttendanceDeliveryRecord>;
  listLifecycle(
    institutionId: string,
  ): Promise<TeacherSessionLifecycleDeliveryRecord[]>;
  retryClose(
    record: TeacherSessionLifecycleDeliveryRecord,
    context: ClassDeviceAttendanceRecoveryContext,
  ): Promise<TeacherSessionLifecycleDeliveryRecord>;
};

function normalizedText(value: unknown) {
  return String(value || "").trim();
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

function classAttendance(
  records: TeacherAttendanceDeliveryRecord[],
  classId: string,
) {
  return records
    .filter((record) => record.class_id === classId)
    .sort((left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.operation_id.localeCompare(right.operation_id),
    );
}

function sessionMatches(
  attendance: TeacherAttendanceDeliveryRecord,
  sessionId: string,
) {
  return (
    attendance.session_id === sessionId ||
    attendance.session_reference === sessionId
  );
}

function closeBelongsToClass(
  record: TeacherSessionLifecycleDeliveryRecord,
  classId: string,
  attendance: TeacherAttendanceDeliveryRecord[],
) {
  if (record.kind !== "close") return false;
  if (record.class_id) return record.class_id === classId;
  if (
    record.attendance_operation_id &&
    attendance.some(
      (candidate) =>
        candidate.operation_id === record.attendance_operation_id &&
        candidate.class_id === classId,
    )
  ) {
    return true;
  }
  return !!record.session_id && attendance.some(
    (candidate) =>
      candidate.class_id === classId &&
      sessionMatches(candidate, record.session_id!),
  );
}

function pendingCount(
  attendance: TeacherAttendanceDeliveryRecord[],
  lifecycle: TeacherSessionLifecycleDeliveryRecord[],
  classId: string,
) {
  const scopedAttendance = classAttendance(attendance, classId);
  const attendancePending = scopedAttendance.filter(
    (record) => !attendanceResolved(record),
  ).length;
  const closePending = lifecycle.filter(
    (record) =>
      closeBelongsToClass(record, classId, scopedAttendance) &&
      record.state !== "relay_confirmed",
  ).length;
  return attendancePending + closePending;
}

export async function countClassDeviceAttendanceRecoveryWithDependencies(
  context: Pick<
    ClassDeviceAttendanceRecoveryContext,
    "institutionId" | "classId"
  >,
  deps: Pick<
    ClassDeviceAttendanceRecoveryDependencies,
    "listAttendance" | "listLifecycle"
  >,
) {
  const institutionId = normalizedText(context.institutionId);
  const classId = normalizedText(context.classId);
  if (!institutionId || !classId) return 0;
  const [attendance, lifecycle] = await Promise.all([
    deps.listAttendance(institutionId),
    deps.listLifecycle(institutionId),
  ]);
  return pendingCount(attendance, lifecycle, classId);
}

export async function recoverClassDeviceAttendanceWithDependencies(
  context: ClassDeviceAttendanceRecoveryContext,
  deps: ClassDeviceAttendanceRecoveryDependencies,
): Promise<ClassDeviceAttendanceRecoverySummary> {
  const institutionId = normalizedText(context.institutionId);
  const classId = normalizedText(context.classId);
  const actorProfileId = normalizedText(context.actorProfileId);
  const relayBaseUrl = normalizedText(context.relayBaseUrl);
  const relayAccessToken = normalizedText(context.relayAccessToken);
  if (!institutionId) throw new Error("institution_id_required");
  if (!classId) throw new Error("class_id_required");
  if (!actorProfileId) throw new Error("actor_profile_id_required");

  const originalAttendance = await deps.listAttendance(institutionId);
  const originalLifecycle = await deps.listLifecycle(institutionId);
  const pendingBefore = pendingCount(
    originalAttendance,
    originalLifecycle,
    classId,
  );
  const summary: ClassDeviceAttendanceRecoverySummary = {
    pending_before: pendingBefore,
    pending_after: pendingBefore,
    attendance_retried: 0,
    attendance_secured: 0,
    closes_retried: 0,
    closes_confirmed: 0,
    closes_waiting_for_attendance: 0,
    requires_attention: 0,
    relay_unreachable: false,
  };

  if (!relayBaseUrl || !relayAccessToken) {
    summary.relay_unreachable = pendingBefore > 0;
    return summary;
  }

  const scopedAttendance = classAttendance(originalAttendance, classId);
  const attendanceByOperation = new Map(
    originalAttendance.map((record) => [record.operation_id, record]),
  );

  for (const record of scopedAttendance) {
    if (!attendanceRetryable(record)) {
      if (attendanceNeedsAttention(record)) summary.requires_attention += 1;
      continue;
    }
    summary.attendance_retried += 1;
    const next = await deps.retryAttendance(record, {
      ...context,
      institutionId,
      classId,
      actorProfileId,
      relayBaseUrl,
      relayAccessToken,
    });
    attendanceByOperation.set(next.operation_id, next);
    if (attendanceResolved(next)) summary.attendance_secured += 1;
    else if (attendanceNeedsAttention(next)) summary.requires_attention += 1;
    if (
      next.state === "device_pending" &&
      (
        next.last_status === 0 ||
        next.last_error === "relay_unreachable" ||
        next.last_error === "relay_presence_proof_unavailable"
      )
    ) {
      summary.relay_unreachable = true;
    }
  }

  const attendanceAfterRetry = Array.from(attendanceByOperation.values());
  const closeRecords = originalLifecycle
    .filter((record) =>
      closeBelongsToClass(record, classId, attendanceAfterRetry),
    )
    .sort((left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.operation_id.localeCompare(right.operation_id),
    );

  for (const close of closeRecords) {
    if (close.state === "relay_confirmed") continue;
    if (close.state === "blocked") {
      summary.requires_attention += 1;
      continue;
    }

    const dependency = close.attendance_operation_id
      ? attendanceByOperation.get(close.attendance_operation_id) || null
      : null;
    const sessionAttendance = close.session_id
      ? attendanceAfterRetry.filter((record) =>
          sessionMatches(record, close.session_id!),
        )
      : [];
    const attendanceReady = dependency
      ? attendanceResolved(dependency)
      : sessionAttendance.length === 0 ||
        sessionAttendance.every(attendanceResolved);

    if (!attendanceReady) {
      summary.closes_waiting_for_attendance += 1;
      continue;
    }

    summary.closes_retried += 1;
    const next = await deps.retryClose(close, {
      ...context,
      institutionId,
      classId,
      actorProfileId,
      relayBaseUrl,
      relayAccessToken,
    });
    if (next.state === "relay_confirmed") summary.closes_confirmed += 1;
    else if (next.state === "blocked") summary.requires_attention += 1;
    else if (
      next.last_status === 0 ||
      next.last_error === "relay_unreachable"
    ) {
      summary.relay_unreachable = true;
    }
  }

  const [finalAttendance, finalLifecycle] = await Promise.all([
    deps.listAttendance(institutionId),
    deps.listLifecycle(institutionId),
  ]);
  summary.pending_after = pendingCount(
    finalAttendance,
    finalLifecycle,
    classId,
  );
  return summary;
}

function productionDependencies(): ClassDeviceAttendanceRecoveryDependencies {
  return {
    listAttendance: listTeacherAttendanceOperations,
    retryAttendance: async (record, context) =>
      await retryTeacherAttendanceOperationOnRelay(record, {
        actorProfileId: context.actorProfileId,
        relayBaseUrl: context.relayBaseUrl,
        relayAccessToken: context.relayAccessToken,
      }),
    listLifecycle: listTeacherSessionLifecycleOperations,
    retryClose: async (record, context) =>
      await retryTeacherSessionCloseOnRelay(record, {
        relayBaseUrl: context.relayBaseUrl,
        relayAccessToken: context.relayAccessToken,
      }),
  };
}

export async function countClassDeviceAttendanceRecovery(
  context: Pick<
    ClassDeviceAttendanceRecoveryContext,
    "institutionId" | "classId"
  >,
) {
  return await countClassDeviceAttendanceRecoveryWithDependencies(
    context,
    productionDependencies(),
  );
}

export async function recoverClassDeviceAttendance(
  context: ClassDeviceAttendanceRecoveryContext,
) {
  return await recoverClassDeviceAttendanceWithDependencies(
    context,
    productionDependencies(),
  );
}
