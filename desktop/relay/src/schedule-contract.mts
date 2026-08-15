import {
  getInstitutionMeta,
  schemaVersion,
  type RelayDatabase,
} from "./db.mjs";
import { SYNC_PROTOCOL_VERSION } from "./types.mjs";

export const RELAY_VERSION = "0.2.1";
export const RELAY_CAPABILITIES = {
  attendance_session_open: true,
  attendance_write: true,
  attendance_session_close: true,
  attendance_transition: true,
  class_device_scope_v1: true,
  bootstrap_revision_ack_v1: true,
  admin_schedule_status_v1: true,
  grades_workspace_v1: true,
} as const;

function storedRevision(db: RelayDatabase, institutionId: string) {
  const value = getInstitutionMeta(
    db,
    institutionId,
    "attendance_schedule_revision",
  );
  if (value === null) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

export function institutionScheduleContract(
  db: RelayDatabase,
  institutionId: string,
) {
  const snapshotRevision = storedRevision(db, institutionId);
  const generatedAt = getInstitutionMeta(
    db,
    institutionId,
    "attendance_schedule_generated_at",
  );
  return {
    snapshot_revision: snapshotRevision,
    generated_at: generatedAt,
    schedule_status: snapshotRevision === null ? "not_prepared" : "ready",
  } as const;
}

export function relayRuntimeContract(
  db: RelayDatabase,
  teacherAttendanceWritesEnabled: boolean,
) {
  return {
    relay_version: RELAY_VERSION,
    schema_version: schemaVersion(db),
    protocol_version: SYNC_PROTOCOL_VERSION,
    teacher_attendance_writes_enabled: teacherAttendanceWritesEnabled,
    capabilities: RELAY_CAPABILITIES,
  };
}
