-- Schema 4: physical tenant partitioning for every pedagogical identifier.
-- db.mts runs the preflight checks before this script and applies it atomically
-- with foreign_keys disabled, followed by foreign_key_check before commit.

CREATE TABLE relay_institution_meta (
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, key)
);

INSERT INTO relay_institution_meta(institution_id, key, value, updated_at)
SELECT i.id, 'relay_device_id', m.value, m.updated_at
FROM relay_meta m
JOIN institutions i
  ON i.id = substr(m.key, length('relay_device_id:') + 1)
WHERE m.key LIKE 'relay_device_id:%';

INSERT OR IGNORE INTO relay_institution_meta(institution_id, key, value, updated_at)
SELECT d.institution_id, 'relay_device_id', m.value, m.updated_at
FROM relay_meta m
JOIN relay_devices d ON d.id = m.value
WHERE m.key = 'relay_device_id';

INSERT INTO relay_institution_meta(institution_id, key, value, updated_at)
SELECT i.id, 'last_cloud_sync_at', m.value, m.updated_at
FROM relay_meta m
JOIN institutions i
  ON i.id = substr(m.key, length('last_cloud_sync_at:') + 1)
WHERE m.key LIKE 'last_cloud_sync_at:%';

INSERT OR IGNORE INTO relay_institution_meta(institution_id, key, value, updated_at)
SELECT i.id, 'last_cloud_sync_at', m.value, m.updated_at
FROM relay_meta m
CROSS JOIN institutions i
WHERE m.key = 'last_cloud_sync_at'
  AND (SELECT COUNT(*) FROM institutions) = 1;

DELETE FROM relay_meta
WHERE key = 'relay_device_id'
   OR key = 'last_cloud_sync_at'
   OR key LIKE 'relay_device_id:%'
   OR key LIKE 'last_cloud_sync_at:%';

DROP INDEX IF EXISTS academic_years_one_current;
DROP INDEX IF EXISTS profiles_institution_active;
DROP INDEX IF EXISTS classes_institution_year;
DROP INDEX IF EXISTS students_institution_active;
DROP INDEX IF EXISTS class_enrollments_roster;
DROP INDEX IF EXISTS institution_periods_schedule;
DROP INDEX IF EXISTS teacher_timetables_monitor;
DROP INDEX IF EXISTS teacher_absences_monitor;
DROP INDEX IF EXISTS teacher_sessions_monitor;
DROP INDEX IF EXISTS grade_evaluations_lookup;
DROP INDEX IF EXISTS sync_outbox_ready;
DROP INDEX IF EXISTS sync_outbox_entity;
DROP INDEX IF EXISTS sync_conflicts_unresolved;
DROP INDEX IF EXISTS sync_bootstrap_runs_institution_time;

ALTER TABLE academic_years RENAME TO __v3_academic_years;
ALTER TABLE profiles RENAME TO __v3_profiles;
ALTER TABLE user_roles RENAME TO __v3_user_roles;
ALTER TABLE classes RENAME TO __v3_classes;
ALTER TABLE subjects RENAME TO __v3_subjects;
ALTER TABLE teacher_subjects RENAME TO __v3_teacher_subjects;
ALTER TABLE students RENAME TO __v3_students;
ALTER TABLE class_enrollments RENAME TO __v3_class_enrollments;
ALTER TABLE institution_periods RENAME TO __v3_institution_periods;
ALTER TABLE teacher_timetables RENAME TO __v3_teacher_timetables;
ALTER TABLE teacher_absence_requests RENAME TO __v3_teacher_absence_requests;
ALTER TABLE teacher_sessions RENAME TO __v3_teacher_sessions;
ALTER TABLE attendance_marks RENAME TO __v3_attendance_marks;
ALTER TABLE grade_periods RENAME TO __v3_grade_periods;
ALTER TABLE grade_evaluations RENAME TO __v3_grade_evaluations;
ALTER TABLE student_grades RENAME TO __v3_student_grades;
ALTER TABLE textbook_assignments RENAME TO __v3_textbook_assignments;
ALTER TABLE textbook_items RENAME TO __v3_textbook_items;
ALTER TABLE textbook_sessions RENAME TO __v3_textbook_sessions;
ALTER TABLE textbook_completions RENAME TO __v3_textbook_completions;
ALTER TABLE offline_documents RENAME TO __v3_offline_documents;
ALTER TABLE sync_outbox RENAME TO __v3_sync_outbox;
ALTER TABLE sync_inbox RENAME TO __v3_sync_inbox;
ALTER TABLE sync_conflicts RENAME TO __v3_sync_conflicts;
ALTER TABLE relay_devices RENAME TO __v3_relay_devices;
ALTER TABLE sync_bootstrap_runs RENAME TO __v3_sync_bootstrap_runs;

CREATE TABLE academic_years (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, code)
);

CREATE UNIQUE INDEX academic_years_one_current
  ON academic_years(institution_id)
  WHERE is_current = 1 AND deleted_at IS NULL;

CREATE TABLE profiles (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE INDEX profiles_institution_active
  ON profiles(institution_id, is_active, display_name);

CREATE TABLE user_roles (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'class_device', 'correspondent', 'staff')),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, profile_id, role),
  FOREIGN KEY (institution_id, profile_id)
    REFERENCES profiles(institution_id, id) ON DELETE CASCADE
);

CREATE TABLE classes (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  label TEXT NOT NULL,
  level TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE INDEX classes_institution_year
  ON classes(institution_id, academic_year, label);

CREATE TABLE subjects (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  base_subject_id TEXT,
  name TEXT NOT NULL,
  short_name TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE TABLE teacher_subjects (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, teacher_id, subject_id),
  FOREIGN KEY (institution_id, teacher_id)
    REFERENCES profiles(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, subject_id)
    REFERENCES subjects(institution_id, id) ON DELETE CASCADE
);

CREATE TABLE students (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  registration_number TEXT,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT NOT NULL,
  gender TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE INDEX students_institution_active
  ON students(institution_id, is_active, display_name);

CREATE TABLE class_enrollments (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, class_id, student_id, start_date),
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, student_id)
    REFERENCES students(institution_id, id) ON DELETE CASCADE
);

CREATE INDEX class_enrollments_roster
  ON class_enrollments(institution_id, class_id, end_date);

CREATE TABLE institution_periods (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 7),
  label TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE INDEX institution_periods_schedule
  ON institution_periods(institution_id, weekday, start_time);

CREATE TABLE teacher_timetables (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  academic_year TEXT,
  class_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 7),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, class_id, subject_id, teacher_id, period_id),
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, subject_id)
    REFERENCES subjects(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, teacher_id)
    REFERENCES profiles(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, period_id)
    REFERENCES institution_periods(institution_id, id) ON DELETE CASCADE
);

CREATE INDEX teacher_timetables_monitor
  ON teacher_timetables(institution_id, teacher_id, class_id, period_id);

CREATE TABLE teacher_absence_requests (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason_label TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_comment TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, teacher_id)
    REFERENCES profiles(institution_id, id) ON DELETE CASCADE
);

CREATE INDEX teacher_absences_monitor
  ON teacher_absence_requests(institution_id, teacher_id, start_date, end_date, status);

CREATE TABLE teacher_sessions (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  client_session_id TEXT,
  class_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  period_id TEXT,
  started_at TEXT NOT NULL,
  actual_call_at TEXT,
  ended_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('teacher', 'class_device', 'admin')),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, client_session_id),
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, subject_id)
    REFERENCES subjects(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, teacher_id)
    REFERENCES profiles(institution_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id, period_id)
    REFERENCES institution_periods(institution_id, id)
);

CREATE INDEX teacher_sessions_monitor
  ON teacher_sessions(institution_id, started_at, class_id, subject_id, teacher_id);

CREATE TABLE attendance_marks (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  late_minutes INTEGER CHECK (late_minutes IS NULL OR late_minutes >= 0),
  comment TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, session_id, student_id),
  FOREIGN KEY (institution_id, session_id)
    REFERENCES teacher_sessions(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, student_id)
    REFERENCES students(institution_id, id) ON DELETE RESTRICT
);

CREATE TABLE grade_periods (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  label TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE TABLE grade_evaluations (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  teacher_id TEXT,
  grade_period_id TEXT,
  title TEXT NOT NULL,
  evaluation_date TEXT,
  max_score REAL NOT NULL DEFAULT 20 CHECK (max_score > 0),
  coefficient REAL NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, subject_id)
    REFERENCES subjects(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, teacher_id)
    REFERENCES profiles(institution_id, id),
  FOREIGN KEY (institution_id, grade_period_id)
    REFERENCES grade_periods(institution_id, id)
);

CREATE INDEX grade_evaluations_lookup
  ON grade_evaluations(institution_id, class_id, subject_id, grade_period_id);

CREATE TABLE student_grades (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  evaluation_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  score REAL,
  comment TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, evaluation_id, student_id),
  FOREIGN KEY (institution_id, evaluation_id)
    REFERENCES grade_evaluations(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, student_id)
    REFERENCES students(institution_id, id) ON DELETE RESTRICT
);

CREATE TABLE textbook_assignments (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  teacher_id TEXT,
  title TEXT NOT NULL,
  source_document_json TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, subject_id)
    REFERENCES subjects(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, teacher_id)
    REFERENCES profiles(institution_id, id)
);

CREATE TABLE textbook_items (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  content TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, assignment_id)
    REFERENCES textbook_assignments(institution_id, id) ON DELETE CASCADE
);

CREATE TABLE textbook_sessions (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  client_session_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  teacher_id TEXT,
  session_title TEXT NOT NULL,
  session_date TEXT NOT NULL,
  period_id TEXT,
  period_label TEXT,
  start_time TEXT,
  end_time TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  content TEXT NOT NULL,
  homework TEXT,
  observations TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, client_session_id),
  FOREIGN KEY (institution_id, assignment_id)
    REFERENCES textbook_assignments(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, item_id)
    REFERENCES textbook_items(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, teacher_id)
    REFERENCES profiles(institution_id, id),
  FOREIGN KEY (institution_id, period_id)
    REFERENCES institution_periods(institution_id, id)
);

CREATE TABLE textbook_completions (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'reopened')),
  note TEXT,
  completed_at TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, assignment_id, item_id),
  FOREIGN KEY (institution_id, assignment_id)
    REFERENCES textbook_assignments(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, item_id)
    REFERENCES textbook_items(institution_id, id) ON DELETE CASCADE
);

CREATE TABLE offline_documents (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bulletin', 'signature', 'logo', 'profile_photo', 'textbook_attachment')),
  owner_id TEXT,
  media_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, sha256)
);

CREATE TABLE sync_outbox (
  operation_id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  actor_profile_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
  base_server_version INTEGER NOT NULL DEFAULT 0 CHECK (base_server_version >= 0),
  payload_json TEXT,
  occurred_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'blocked')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  last_status INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (institution_id, operation_id)
);

CREATE INDEX sync_outbox_ready
  ON sync_outbox(institution_id, state, next_attempt_at, occurred_at);

CREATE INDEX sync_outbox_entity
  ON sync_outbox(institution_id, entity_type, entity_id, state);

CREATE TABLE sync_inbox (
  event_id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
  server_version INTEGER NOT NULL CHECK (server_version >= 0),
  payload_json TEXT,
  occurred_at TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, event_id)
);

CREATE TABLE sync_conflicts (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  operation_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  remote_action TEXT NOT NULL CHECK (remote_action IN ('upsert', 'delete')),
  local_payload_json TEXT,
  remote_payload_json TEXT,
  local_base_version INTEGER NOT NULL DEFAULT 0,
  remote_server_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('keep_local', 'accept_remote', 'merged')),
  resolved_by TEXT,
  PRIMARY KEY (institution_id, id),
  UNIQUE (institution_id, event_id),
  FOREIGN KEY (institution_id, event_id)
    REFERENCES sync_inbox(institution_id, event_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX sync_conflicts_unresolved
  ON sync_conflicts(institution_id, resolved_at, detected_at);

CREATE TABLE relay_devices (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('relay', 'admin_desktop', 'teacher_device', 'class_device')),
  public_key TEXT,
  token_hash TEXT,
  paired_at TEXT,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (institution_id, id)
);

CREATE TABLE sync_bootstrap_runs (
  snapshot_id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  imported_entities INTEGER NOT NULL DEFAULT 0 CHECK (imported_entities >= 0),
  preserved_local_entities INTEGER NOT NULL DEFAULT 0 CHECK (preserved_local_entities >= 0),
  deferred_entities INTEGER NOT NULL DEFAULT 0 CHECK (deferred_entities >= 0),
  rejected_entities INTEGER NOT NULL DEFAULT 0 CHECK (rejected_entities >= 0),
  collections_json TEXT NOT NULL DEFAULT '{}',
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  source_skipped_entities INTEGER NOT NULL DEFAULT 0 CHECK (source_skipped_entities >= 0),
  source_diagnostics_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (institution_id, snapshot_id)
);

CREATE INDEX sync_bootstrap_runs_institution_time
  ON sync_bootstrap_runs(institution_id, generated_at DESC);

INSERT INTO academic_years SELECT * FROM __v3_academic_years;
INSERT INTO profiles SELECT * FROM __v3_profiles;
INSERT INTO user_roles SELECT * FROM __v3_user_roles;
INSERT INTO classes SELECT * FROM __v3_classes;
INSERT INTO subjects SELECT * FROM __v3_subjects;
INSERT INTO teacher_subjects SELECT * FROM __v3_teacher_subjects;
INSERT INTO students SELECT * FROM __v3_students;
INSERT INTO class_enrollments SELECT * FROM __v3_class_enrollments;
INSERT INTO institution_periods SELECT * FROM __v3_institution_periods;
INSERT INTO teacher_timetables SELECT * FROM __v3_teacher_timetables;
INSERT INTO teacher_absence_requests SELECT * FROM __v3_teacher_absence_requests;
INSERT INTO teacher_sessions SELECT * FROM __v3_teacher_sessions;
INSERT INTO attendance_marks SELECT * FROM __v3_attendance_marks;
INSERT INTO grade_periods SELECT * FROM __v3_grade_periods;
INSERT INTO grade_evaluations SELECT * FROM __v3_grade_evaluations;
INSERT INTO student_grades SELECT * FROM __v3_student_grades;
INSERT INTO textbook_assignments SELECT * FROM __v3_textbook_assignments;
INSERT INTO textbook_items SELECT * FROM __v3_textbook_items;
INSERT INTO textbook_sessions SELECT * FROM __v3_textbook_sessions;
INSERT INTO textbook_completions SELECT * FROM __v3_textbook_completions;
INSERT INTO offline_documents SELECT * FROM __v3_offline_documents;
INSERT INTO sync_outbox SELECT * FROM __v3_sync_outbox;
INSERT INTO sync_inbox SELECT * FROM __v3_sync_inbox;
INSERT INTO sync_conflicts SELECT * FROM __v3_sync_conflicts;
INSERT INTO relay_devices SELECT * FROM __v3_relay_devices;

INSERT INTO sync_bootstrap_runs(
  snapshot_id, institution_id, generated_at, started_at, completed_at, status,
  imported_entities, preserved_local_entities, deferred_entities, rejected_entities,
  collections_json, diagnostics_json, error, source_skipped_entities,
  source_diagnostics_json
)
SELECT snapshot_id, institution_id, generated_at, started_at, completed_at, status,
       imported_entities, preserved_local_entities, 0, 0,
       collections_json, '[]', error, source_skipped_entities,
       source_diagnostics_json
FROM __v3_sync_bootstrap_runs;

CREATE TRIGGER profiles_null_optional_references_before_delete
BEFORE DELETE ON profiles
BEGIN
  UPDATE grade_evaluations
  SET teacher_id = NULL
  WHERE institution_id = OLD.institution_id AND teacher_id = OLD.id;
  UPDATE textbook_assignments
  SET teacher_id = NULL
  WHERE institution_id = OLD.institution_id AND teacher_id = OLD.id;
  UPDATE textbook_sessions
  SET teacher_id = NULL
  WHERE institution_id = OLD.institution_id AND teacher_id = OLD.id;
END;

CREATE TRIGGER institution_periods_null_optional_references_before_delete
BEFORE DELETE ON institution_periods
BEGIN
  UPDATE teacher_sessions
  SET period_id = NULL
  WHERE institution_id = OLD.institution_id AND period_id = OLD.id;
  UPDATE textbook_sessions
  SET period_id = NULL
  WHERE institution_id = OLD.institution_id AND period_id = OLD.id;
END;

CREATE TRIGGER grade_periods_null_optional_references_before_delete
BEFORE DELETE ON grade_periods
BEGIN
  UPDATE grade_evaluations
  SET grade_period_id = NULL
  WHERE institution_id = OLD.institution_id AND grade_period_id = OLD.id;
END;

DROP TABLE __v3_attendance_marks;
DROP TABLE __v3_student_grades;
DROP TABLE __v3_textbook_completions;
DROP TABLE __v3_textbook_sessions;
DROP TABLE __v3_textbook_items;
DROP TABLE __v3_textbook_assignments;
DROP TABLE __v3_grade_evaluations;
DROP TABLE __v3_grade_periods;
DROP TABLE __v3_teacher_sessions;
DROP TABLE __v3_teacher_absence_requests;
DROP TABLE __v3_teacher_timetables;
DROP TABLE __v3_institution_periods;
DROP TABLE __v3_class_enrollments;
DROP TABLE __v3_students;
DROP TABLE __v3_teacher_subjects;
DROP TABLE __v3_subjects;
DROP TABLE __v3_classes;
DROP TABLE __v3_user_roles;
DROP TABLE __v3_profiles;
DROP TABLE __v3_academic_years;
DROP TABLE __v3_offline_documents;
DROP TABLE __v3_sync_conflicts;
DROP TABLE __v3_sync_inbox;
DROP TABLE __v3_sync_outbox;
DROP TABLE __v3_relay_devices;
DROP TABLE __v3_sync_bootstrap_runs;
