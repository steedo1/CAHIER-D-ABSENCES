ALTER TABLE teacher_sessions ADD COLUMN session_date TEXT;
ALTER TABLE teacher_sessions ADD COLUMN session_state TEXT NOT NULL DEFAULT 'open'
  CHECK (session_state IN ('open', 'finalizing', 'closed'));
ALTER TABLE teacher_sessions ADD COLUMN scheduled_start_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN requested_start_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN actual_started_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN scheduled_end_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN finalizing_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN grace_expires_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN closed_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN payable_end_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN closure_source TEXT
  CHECK (closure_source IS NULL OR closure_source IN (
    'teacher_confirmed', 'next_slot_takeover',
    'automatic_grace_expired', 'cloud_existing'
  ));
ALTER TABLE teacher_sessions ADD COLUMN closure_confirmation TEXT
  CHECK (closure_confirmation IS NULL OR closure_confirmation IN ('confirmed', 'unconfirmed'));
ALTER TABLE teacher_sessions ADD COLUMN requires_payroll_review INTEGER NOT NULL DEFAULT 0
  CHECK (requires_payroll_review IN (0, 1));
ALTER TABLE teacher_sessions ADD COLUMN local_lifecycle_managed INTEGER NOT NULL DEFAULT 0
  CHECK (local_lifecycle_managed IN (0, 1));
ALTER TABLE teacher_sessions ADD COLUMN last_attendance_operation_id TEXT;
ALTER TABLE teacher_sessions ADD COLUMN attendance_durable_at TEXT;
ALTER TABLE teacher_sessions ADD COLUMN attendance_snapshot_status TEXT NOT NULL DEFAULT 'none'
  CHECK (attendance_snapshot_status IN ('none', 'partial', 'complete'));

CREATE TABLE teacher_session_closure_events (
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  operation_type TEXT NOT NULL CHECK (operation_type = 'attendance.session.close'),
  requested_by_profile_id TEXT,
  closure_source TEXT NOT NULL CHECK (closure_source IN (
    'teacher_confirmed', 'next_slot_takeover', 'automatic_grace_expired'
  )),
  closure_confirmation TEXT NOT NULL CHECK (closure_confirmation IN ('confirmed', 'unconfirmed')),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  payload_json TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  payable_end_at TEXT NOT NULL,
  requires_payroll_review INTEGER NOT NULL CHECK (requires_payroll_review IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, session_id),
  UNIQUE (institution_id, operation_id),
  FOREIGN KEY (institution_id, session_id)
    REFERENCES teacher_sessions(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, requested_by_profile_id)
    REFERENCES profiles(institution_id, id) ON DELETE RESTRICT
);

CREATE INDEX teacher_session_closure_events_review
  ON teacher_session_closure_events(
    institution_id, requires_payroll_review, closed_at, session_id
  );

CREATE TABLE teacher_session_transition_operations (
  operation_id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  operation_type TEXT NOT NULL CHECK (operation_type = 'attendance.session.transition'),
  requesting_teacher_profile_id TEXT NOT NULL,
  previous_session_id TEXT NOT NULL,
  new_session_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  requested_start_at TEXT NOT NULL,
  close_operation_id TEXT NOT NULL,
  open_operation_id TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'transitioned_on_relay'
    CHECK (state IN ('transitioned_on_relay', 'synced_with_cloud', 'blocked', 'conflict')),
  accepted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, operation_id),
  UNIQUE (institution_id, close_operation_id),
  UNIQUE (institution_id, open_operation_id),
  FOREIGN KEY (institution_id, requesting_teacher_profile_id)
    REFERENCES profiles(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, previous_session_id)
    REFERENCES teacher_sessions(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, new_session_id)
    REFERENCES teacher_sessions(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, period_id)
    REFERENCES institution_periods(institution_id, id) ON DELETE RESTRICT
);

CREATE INDEX teacher_session_transition_operations_sessions
  ON teacher_session_transition_operations(
    institution_id, previous_session_id, new_session_id, accepted_at
  );

CREATE INDEX teacher_sessions_lifecycle_due
  ON teacher_sessions(
    institution_id, local_lifecycle_managed, session_state,
    scheduled_end_at, grace_expires_at
  );

CREATE INDEX teacher_sessions_review
  ON teacher_sessions(
    institution_id, requires_payroll_review, closed_at, id
  );
