ALTER TABLE sync_outbox
  ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1
    CHECK (protocol_version = 1);

ALTER TABLE sync_outbox
  ADD COLUMN payload_fingerprint TEXT
    CHECK (payload_fingerprint IS NULL OR length(payload_fingerprint) = 64);

CREATE TABLE teacher_attendance_operations (
  operation_id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  operation_type TEXT NOT NULL CHECK (operation_type = 'attendance.call.submit'),
  teacher_profile_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'secured_on_relay'
    CHECK (state IN ('secured_on_relay', 'synced_with_cloud', 'blocked', 'conflict')),
  accepted_at TEXT NOT NULL,
  materialized_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, operation_id),
  FOREIGN KEY (institution_id, teacher_profile_id)
    REFERENCES profiles(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, session_id)
    REFERENCES teacher_sessions(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, period_id)
    REFERENCES institution_periods(institution_id, id) ON DELETE RESTRICT
);

CREATE INDEX teacher_attendance_operations_state
  ON teacher_attendance_operations(institution_id, state, accepted_at);

CREATE INDEX teacher_attendance_operations_session
  ON teacher_attendance_operations(institution_id, session_id, accepted_at);
