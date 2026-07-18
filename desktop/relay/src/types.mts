export const SYNC_PROTOCOL_VERSION = 1 as const;

export const SYNC_ENTITY_TYPES = [
  "institution",
  "academic_year",
  "profile",
  "user_role",
  "class",
  "subject",
  "teacher_subject",
  "student",
  "class_enrollment",
  "institution_period",
  "teacher_timetable",
  "teacher_absence_request",
  "teacher_session",
  "attendance_mark",
  "grade_period",
  "grade_evaluation",
  "student_grade",
  "textbook_assignment",
  "textbook_item",
  "textbook_session",
  "textbook_completion",
  "offline_document",
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];
export type SyncAction = "upsert" | "delete";
export type OutboxState = "pending" | "sending" | "blocked";

export type SyncOperation = {
  protocol_version: typeof SYNC_PROTOCOL_VERSION;
  operation_id: string;
  institution_id: string;
  device_id: string;
  actor_profile_id?: string | null;
  entity_type: SyncEntityType;
  entity_id: string;
  action: SyncAction;
  base_server_version: number;
  occurred_at: string;
  payload: Record<string, unknown> | null;
};

export type RemoteEvent = {
  protocol_version: typeof SYNC_PROTOCOL_VERSION;
  event_id: string;
  caused_by_operation_id?: string | null;
  institution_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  action: SyncAction;
  server_version: number;
  occurred_at: string;
  payload: Record<string, unknown> | null;
};

export type EnqueueResult = {
  operation_id: string;
  inserted: boolean;
};

export type ApplyRemoteResult =
  | { event_id: string; status: "applied" | "duplicate" }
  | { event_id: string; status: "conflict"; conflict_id: string };

export type RelayStatus = {
  ok: true;
  schema_version: number;
  institution_count: number;
  pending_operations: number;
  blocked_operations: number;
  unresolved_conflicts: number;
  materialization_failures: number;
  last_cloud_sync_at: string | null;
};

export type AttendanceMonitorStatus =
  | "missing"
  | "late"
  | "ok"
  | "pending_absence"
  | "justified_absence";

export type AttendanceMonitorRow = {
  id: string;
  date: string;
  period_label: string | null;
  planned_start: string | null;
  planned_end: string | null;
  class_label: string | null;
  subject_name: string | null;
  teacher_name: string;
  teacher_phone: string | null;
  status: AttendanceMonitorStatus;
  late_minutes: number | null;
  opened_from: "teacher" | "class_device" | null;
  absence_request_status: "pending" | "approved" | null;
  absence_reason_label: string | null;
  absence_admin_comment: string | null;
};
