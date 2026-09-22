export type AttendanceCacheScope = {
  institution_id: string;
  actor_profile_id: string;
  schedule_revision: number;
};

export function validAttendanceScope(value: unknown): value is AttendanceCacheScope {
  const scope = value as AttendanceCacheScope | null;
  return Boolean(scope?.institution_id && scope.actor_profile_id &&
    Number.isSafeInteger(scope.schedule_revision) && scope.schedule_revision >= 0);
}

export function isTeacherCacheKey(key: string) {
  return key.startsWith("teacher:") || key === "offline:readiness:teacher";
}

// Ongoing calls survive an EDT replacement; schedule projections never do.
export function isTeacherScheduleKey(key: string) {
  return /^(teacher:(classes:|roster:|offline:bootstrap|inst:)|offline:readiness:teacher)/.test(key);
}

export function teacherCacheKey(key: string, scope: AttendanceCacheScope) {
  if (!validAttendanceScope(scope)) throw new Error("attendance_cache_scope_required");
  return ["teacher-cache:v1", scope.institution_id, scope.actor_profile_id,
    isTeacherScheduleKey(key) ? scope.schedule_revision : "identity", key]
    .map(String).map(encodeURIComponent).join(":");
}

export function scheduleIsCurrent(revision: unknown, knownRevision: number | null) {
  return Number.isSafeInteger(revision) && Number(revision) >= 0 &&
    (knownRevision === null || Number(revision) >= knownRevision);
}
