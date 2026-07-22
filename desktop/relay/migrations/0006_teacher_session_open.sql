CREATE TABLE teacher_session_open_operations (
  operation_id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  operation_type TEXT NOT NULL CHECK (operation_type = 'attendance.session.open'),
  teacher_profile_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  timetable_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  local_session_id TEXT NOT NULL,
  remote_session_id TEXT,
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  payload_json TEXT NOT NULL,
  created_locally INTEGER NOT NULL CHECK (created_locally IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'opened_on_relay'
    CHECK (state IN ('opened_on_relay', 'synced_with_cloud', 'blocked', 'conflict')),
  accepted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, operation_id),
  FOREIGN KEY (institution_id, teacher_profile_id)
    REFERENCES profiles(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, period_id)
    REFERENCES institution_periods(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, timetable_id)
    REFERENCES teacher_timetables(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, subject_id)
    REFERENCES subjects(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, local_session_id)
    REFERENCES teacher_sessions(institution_id, id) ON DELETE RESTRICT
);

CREATE INDEX teacher_session_open_operations_session
  ON teacher_session_open_operations(institution_id, local_session_id, accepted_at);

CREATE UNIQUE INDEX teacher_session_open_operations_remote
  ON teacher_session_open_operations(institution_id, remote_session_id)
  WHERE remote_session_id IS NOT NULL;

CREATE TABLE sync_outbox_dependencies (
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  depends_on_operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, operation_id, depends_on_operation_id),
  CHECK (operation_id <> depends_on_operation_id),
  FOREIGN KEY (institution_id, operation_id)
    REFERENCES sync_outbox(institution_id, operation_id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, depends_on_operation_id)
    REFERENCES sync_outbox(institution_id, operation_id) ON DELETE CASCADE
);

CREATE INDEX sync_outbox_dependencies_parent
  ON sync_outbox_dependencies(institution_id, depends_on_operation_id, operation_id);
