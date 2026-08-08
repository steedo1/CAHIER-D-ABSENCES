"use client";

import {
  cacheGet,
  outboxStats,
  type OutboxStats,
} from "@/lib/offline";
import {
  listTeacherAttendanceOperations,
  type TeacherAttendanceDeliveryRecord,
} from "@/lib/teacher-attendance-delivery";
import {
  listTeacherSessionOpenOperations,
  type TeacherSessionDeliveryRecord,
} from "@/lib/teacher-session-delivery";
import {
  listTeacherSessionLifecycleOperations,
  type TeacherSessionLifecycleDeliveryRecord,
} from "@/lib/teacher-session-lifecycle-delivery";

export type TeacherOfflinePendingCounts = {
  device_pending: number;
  relay_secured: number;
  delivery_unknown: number;
  blocked: number;
  total: number;
};

export type TeacherOfflinePendingSummary = TeacherOfflinePendingCounts & {
  institution_id: string | null;
  at_risk: number;
  requires_authentication: number;
  breakdown: {
    outbox: TeacherOfflinePendingCounts;
    session_open: TeacherOfflinePendingCounts;
    attendance: TeacherOfflinePendingCounts;
    lifecycle: TeacherOfflinePendingCounts;
  };
};

export type TeacherOfflinePendingInput = {
  institutionId?: string | null;
  outbox?: Pick<OutboxStats, "total" | "pending" | "blocked"> | null;
  sessionOpen?: TeacherSessionDeliveryRecord[] | null;
  attendance?: TeacherAttendanceDeliveryRecord[] | null;
  lifecycle?: TeacherSessionLifecycleDeliveryRecord[] | null;
};

export type TeacherOfflinePendingDependencies = {
  getCachedInstitutionId(): Promise<string | null>;
  getOutboxStats(): Promise<Pick<OutboxStats, "total" | "pending" | "blocked">>;
  listSessionOpen(institutionId: string): Promise<TeacherSessionDeliveryRecord[]>;
  listAttendance(institutionId: string): Promise<TeacherAttendanceDeliveryRecord[]>;
  listLifecycle(institutionId: string): Promise<TeacherSessionLifecycleDeliveryRecord[]>;
};

function normalizedText(value: unknown) {
  return String(value || "").trim();
}

function counts(
  input: Partial<Omit<TeacherOfflinePendingCounts, "total">> = {},
): TeacherOfflinePendingCounts {
  const devicePending = Math.max(0, Number(input.device_pending) || 0);
  const relaySecured = Math.max(0, Number(input.relay_secured) || 0);
  const deliveryUnknown = Math.max(0, Number(input.delivery_unknown) || 0);
  const blocked = Math.max(0, Number(input.blocked) || 0);
  return {
    device_pending: devicePending,
    relay_secured: relaySecured,
    delivery_unknown: deliveryUnknown,
    blocked,
    total: devicePending + relaySecured + deliveryUnknown + blocked,
  };
}

export function emptyTeacherOfflinePendingSummary(
  institutionId: string | null = null,
): TeacherOfflinePendingSummary {
  const empty = counts();
  return {
    ...empty,
    institution_id: normalizedText(institutionId) || null,
    at_risk: 0,
    requires_authentication: 0,
    breakdown: {
      outbox: { ...empty },
      session_open: { ...empty },
      attendance: { ...empty },
      lifecycle: { ...empty },
    },
  };
}

export function summarizeTeacherOfflinePending(
  input: TeacherOfflinePendingInput,
): TeacherOfflinePendingSummary {
  const outbox = counts({
    device_pending: input.outbox?.pending || 0,
    blocked: input.outbox?.blocked || 0,
  });

  const sessionOpenRecords = Array.isArray(input.sessionOpen) ? input.sessionOpen : [];
  const sessionOpen = counts({
    device_pending: sessionOpenRecords.filter((record) => record.state === "device_pending").length,
    relay_secured: sessionOpenRecords.filter((record) => record.state === "relay_opened").length,
    blocked: sessionOpenRecords.filter((record) => record.state === "blocked").length,
  });

  const attendanceRecords = Array.isArray(input.attendance) ? input.attendance : [];
  const attendance = counts({
    device_pending: attendanceRecords.filter((record) => record.state === "device_pending").length,
    relay_secured: attendanceRecords.filter((record) => record.state === "relay_secured").length,
    delivery_unknown: attendanceRecords.filter((record) => record.state === "delivery_unknown").length,
    blocked: attendanceRecords.filter((record) =>
      record.state === "blocked" || record.state === "conflict",
    ).length,
  });

  const lifecycleRecords = Array.isArray(input.lifecycle) ? input.lifecycle : [];
  const lifecycle = counts({
    device_pending: lifecycleRecords.filter((record) => record.state === "device_pending").length,
    relay_secured: lifecycleRecords.filter((record) => record.state === "relay_confirmed").length,
    blocked: lifecycleRecords.filter((record) => record.state === "blocked").length,
  });

  const devicePending =
    outbox.device_pending +
    sessionOpen.device_pending +
    attendance.device_pending +
    lifecycle.device_pending;
  const relaySecured =
    sessionOpen.relay_secured +
    attendance.relay_secured +
    lifecycle.relay_secured;
  const deliveryUnknown = attendance.delivery_unknown;
  const blocked =
    outbox.blocked +
    sessionOpen.blocked +
    attendance.blocked +
    lifecycle.blocked;
  const total = devicePending + relaySecured + deliveryUnknown + blocked;

  const requiresAuthentication = [
    ...sessionOpenRecords,
    ...attendanceRecords,
    ...lifecycleRecords,
  ].filter((record) => record.requires_authentication === true).length;

  return {
    institution_id: normalizedText(input.institutionId) || null,
    device_pending: devicePending,
    relay_secured: relaySecured,
    delivery_unknown: deliveryUnknown,
    blocked,
    total,
    at_risk: devicePending + deliveryUnknown + blocked,
    requires_authentication: requiresAuthentication,
    breakdown: {
      outbox,
      session_open: sessionOpen,
      attendance,
      lifecycle,
    },
  };
}

function productionDependencies(): TeacherOfflinePendingDependencies {
  return {
    async getCachedInstitutionId() {
      const value = await cacheGet<Record<string, unknown>>("teacher:inst:basics").catch(
        () => null,
      );
      return normalizedText(value?.institution_id) || null;
    },
    async getOutboxStats() {
      return await outboxStats();
    },
    async listSessionOpen(institutionId) {
      return await listTeacherSessionOpenOperations(institutionId);
    },
    async listAttendance(institutionId) {
      return await listTeacherAttendanceOperations(institutionId);
    },
    async listLifecycle(institutionId) {
      return await listTeacherSessionLifecycleOperations(institutionId);
    },
  };
}

export async function getTeacherOfflinePendingSummaryWithDependencies(
  knownInstitutionId: string | null | undefined,
  deps: TeacherOfflinePendingDependencies,
) {
  const [outbox, cachedInstitutionId] = await Promise.all([
    deps.getOutboxStats(),
    deps.getCachedInstitutionId(),
  ]);
  const institutionId =
    normalizedText(knownInstitutionId) || normalizedText(cachedInstitutionId) || null;

  if (!institutionId) {
    return summarizeTeacherOfflinePending({ outbox, institutionId: null });
  }

  const [sessionOpen, attendance, lifecycle] = await Promise.all([
    deps.listSessionOpen(institutionId),
    deps.listAttendance(institutionId),
    deps.listLifecycle(institutionId),
  ]);

  return summarizeTeacherOfflinePending({
    institutionId,
    outbox,
    sessionOpen,
    attendance,
    lifecycle,
  });
}

export async function getTeacherOfflinePendingSummary(
  knownInstitutionId?: string | null,
) {
  if (typeof window === "undefined") {
    return emptyTeacherOfflinePendingSummary(normalizedText(knownInstitutionId) || null);
  }
  return await getTeacherOfflinePendingSummaryWithDependencies(
    knownInstitutionId,
    productionDependencies(),
  );
}
