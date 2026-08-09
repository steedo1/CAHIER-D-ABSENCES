export const TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION = 1 as const;
export const TEACHER_SESSION_CLOSE_OPERATION_TYPE = "attendance.session.close" as const;
export const TEACHER_SESSION_TRANSITION_OPERATION_TYPE = "attendance.session.transition" as const;

export type TeacherSessionCloseRelayPayload = {
  protocol_version: typeof TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof TEACHER_SESSION_CLOSE_OPERATION_TYPE;
  captured_at_device?: string;
  session_id: string;
};

export type TeacherSessionTransitionRelayPayload = {
  protocol_version: typeof TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof TEACHER_SESSION_TRANSITION_OPERATION_TYPE;
  captured_at_device?: string;
  class_id: string;
  period_id: string;
};

function requiredText(value: unknown, field: string, maxLength = 256) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  if (normalized.length > maxLength) throw new Error(`${field}_too_long`);
  return normalized;
}

function optionalIso(value: unknown, field: string) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field}_invalid`);
  return parsed.toISOString();
}

export function buildTeacherSessionCloseRelayPayload(input: {
  operationId: string;
  sessionId: string;
  capturedAtDevice?: string | Date | null;
}): TeacherSessionCloseRelayPayload {
  const payload: TeacherSessionCloseRelayPayload = {
    protocol_version: TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION,
    operation_id: requiredText(input.operationId, "operation_id", 128),
    operation_type: TEACHER_SESSION_CLOSE_OPERATION_TYPE,
    session_id: requiredText(input.sessionId, "session_id"),
  };
  const capturedAtDevice = optionalIso(input.capturedAtDevice, "captured_at_device");
  if (capturedAtDevice) payload.captured_at_device = capturedAtDevice;
  return payload;
}

export function buildTeacherSessionTransitionRelayPayload(input: {
  operationId: string;
  classId: string;
  periodId: string;
  capturedAtDevice?: string | Date | null;
}): TeacherSessionTransitionRelayPayload {
  const payload: TeacherSessionTransitionRelayPayload = {
    protocol_version: TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION,
    operation_id: requiredText(input.operationId, "operation_id", 128),
    operation_type: TEACHER_SESSION_TRANSITION_OPERATION_TYPE,
    class_id: requiredText(input.classId, "class_id"),
    period_id: requiredText(input.periodId, "period_id"),
  };
  const capturedAtDevice = optionalIso(input.capturedAtDevice, "captured_at_device");
  if (capturedAtDevice) payload.captured_at_device = capturedAtDevice;
  return payload;
}
