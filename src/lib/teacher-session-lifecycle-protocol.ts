export const TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION = 1 as const;
export const TEACHER_SESSION_CLOSE_OPERATION_TYPE = "attendance.session.close" as const;
export const TEACHER_SESSION_TRANSITION_OPERATION_TYPE = "attendance.session.transition" as const;

export type TeacherSessionCloseRelayPayload = {
  protocol_version: typeof TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof TEACHER_SESSION_CLOSE_OPERATION_TYPE;
  session_id: string;
};

export type TeacherSessionTransitionRelayPayload = {
  protocol_version: typeof TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof TEACHER_SESSION_TRANSITION_OPERATION_TYPE;
  class_id: string;
  period_id: string;
};

function requiredText(value: unknown, field: string, maxLength = 256) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  if (normalized.length > maxLength) throw new Error(`${field}_too_long`);
  return normalized;
}

export function buildTeacherSessionCloseRelayPayload(input: {
  operationId: string;
  sessionId: string;
}): TeacherSessionCloseRelayPayload {
  return {
    protocol_version: TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION,
    operation_id: requiredText(input.operationId, "operation_id", 128),
    operation_type: TEACHER_SESSION_CLOSE_OPERATION_TYPE,
    session_id: requiredText(input.sessionId, "session_id"),
  };
}

export function buildTeacherSessionTransitionRelayPayload(input: {
  operationId: string;
  classId: string;
  periodId: string;
}): TeacherSessionTransitionRelayPayload {
  return {
    protocol_version: TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION,
    operation_id: requiredText(input.operationId, "operation_id", 128),
    operation_type: TEACHER_SESSION_TRANSITION_OPERATION_TYPE,
    class_id: requiredText(input.classId, "class_id"),
    period_id: requiredText(input.periodId, "period_id"),
  };
}
