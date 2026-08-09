export const TEACHER_SESSION_OPEN_PROTOCOL_VERSION = 1 as const;
export const TEACHER_SESSION_OPEN_OPERATION_TYPE = "attendance.session.open" as const;

export type TeacherSessionOpenRelayPayload = {
  protocol_version: typeof TEACHER_SESSION_OPEN_PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof TEACHER_SESSION_OPEN_OPERATION_TYPE;
  /** Heure métier capturée et persistée sur l'appareil avant toute tentative réseau. */
  captured_at_device?: string;
  class_id: string;
  period_id: string;
};

function requiredText(value: unknown, name: string, maxLength = 256) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name}_required`);
  if (normalized.length > maxLength) throw new Error(`${name}_too_long`);
  return normalized;
}

function optionalIso(value: unknown, name: string) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${name}_invalid`);
  return parsed.toISOString();
}

export function buildTeacherSessionOpenRelayPayload(input: {
  operationId: string;
  classId: string;
  periodId: string;
  capturedAtDevice?: string | Date | null;
}): TeacherSessionOpenRelayPayload {
  const payload: TeacherSessionOpenRelayPayload = {
    protocol_version: TEACHER_SESSION_OPEN_PROTOCOL_VERSION,
    operation_id: requiredText(input.operationId, "operation_id", 128),
    operation_type: TEACHER_SESSION_OPEN_OPERATION_TYPE,
    class_id: requiredText(input.classId, "class_id"),
    period_id: requiredText(input.periodId, "period_id"),
  };
  const capturedAtDevice = optionalIso(input.capturedAtDevice, "captured_at_device");
  if (capturedAtDevice) payload.captured_at_device = capturedAtDevice;
  return payload;
}
