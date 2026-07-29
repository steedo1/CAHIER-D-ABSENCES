export const TEACHER_ATTENDANCE_PROTOCOL_VERSION = 1 as const;
export const TEACHER_ATTENDANCE_OPERATION_TYPE = "attendance.call.submit" as const;

export type TeacherAttendanceStatus = "present" | "absent" | "late";

export type TeacherAttendanceMark = {
  student_id: string;
  status: TeacherAttendanceStatus;
  comment: string | null;
  observed_at: string | null;
};

export type TeacherAttendanceRelayPayload = {
  protocol_version: typeof TEACHER_ATTENDANCE_PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof TEACHER_ATTENDANCE_OPERATION_TYPE;
  session_id: string;
  class_id: string;
  period_id: string;
  presence_proof?: string;
  marks: TeacherAttendanceMark[];
};

function requiredText(value: unknown, field: string, maxLength = 256) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  if (normalized.length > maxLength) throw new Error(`${field}_too_long`);
  return normalized;
}

export function normalizeTeacherAttendanceMarks(
  values: Array<{
    student_id?: unknown;
    status?: unknown;
    comment?: unknown;
    reason?: unknown;
    observed_at?: unknown;
    late_observed_at?: unknown;
  }>,
): TeacherAttendanceMark[] {
  const byStudent = new Map<string, TeacherAttendanceMark>();

  for (const value of values || []) {
    const studentId = requiredText(value?.student_id, "student_id");
    if (
      value?.status !== "present" &&
      value?.status !== "absent" &&
      value?.status !== "late"
    ) {
      throw new Error("attendance_status_not_supported");
    }
    const rawComment = value.comment ?? value.reason ?? null;
    const comment = rawComment == null || String(rawComment).trim() === ""
      ? null
      : requiredText(rawComment, "comment", 500);
    const rawObservedAt = value.observed_at ?? value.late_observed_at ?? null;
    let observedAt: string | null = null;
    if (value.status === "late" && rawObservedAt != null && String(rawObservedAt).trim()) {
      const parsed = new Date(String(rawObservedAt));
      if (!Number.isFinite(parsed.getTime())) throw new Error("observed_at_invalid");
      observedAt = parsed.toISOString();
    }
    byStudent.set(studentId, {
      student_id: studentId,
      status: value.status,
      comment,
      observed_at: observedAt,
    });
  }

  return Array.from(byStudent.values()).sort((left, right) =>
    left.student_id.localeCompare(right.student_id),
  );
}

export function teacherAttendanceContentKey(input: {
  classId: string;
  periodId: string;
  marks: TeacherAttendanceMark[];
}) {
  return JSON.stringify({
    class_id: requiredText(input.classId, "class_id"),
    period_id: requiredText(input.periodId, "period_id"),
    marks: normalizeTeacherAttendanceMarks(input.marks),
  });
}

export function buildTeacherAttendanceRelayPayload(input: {
  operationId: string;
  sessionId: string;
  classId: string;
  periodId: string;
  marks: TeacherAttendanceMark[];
  presenceProof?: string | null;
}): TeacherAttendanceRelayPayload {
  const marks = normalizeTeacherAttendanceMarks(input.marks);
  if (!marks.length) throw new Error("marks_required");

  const payload: TeacherAttendanceRelayPayload = {
    protocol_version: TEACHER_ATTENDANCE_PROTOCOL_VERSION,
    operation_id: requiredText(input.operationId, "operation_id", 128),
    operation_type: TEACHER_ATTENDANCE_OPERATION_TYPE,
    session_id: requiredText(input.sessionId, "session_id"),
    class_id: requiredText(input.classId, "class_id"),
    period_id: requiredText(input.periodId, "period_id"),
    marks,
  };
  const proof = String(input.presenceProof || "").trim();
  if (proof) payload.presence_proof = requiredText(proof, "presence_proof", 4096);
  return payload;
}

