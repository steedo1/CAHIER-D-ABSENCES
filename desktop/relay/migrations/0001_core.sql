CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  timezone TEXT NOT NULL DEFAULT 'Africa/Abidjan',
  settings_json TEXT NOT NULL DEFAULT '{}',
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current
  ON academic_years(institution_id)
  WHERE is_current = 1 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS profiles_institution_active
  ON profiles(institution_id, is_active, display_name);

CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'class_device', 'correspondent', 'staff')),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, profile_id, role)
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  label TEXT NOT NULL,
  level TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS classes_institution_year
  ON classes(institution_id, academic_year, label);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  base_subject_id TEXT,
  name TEXT NOT NULL,
  short_name TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, teacher_id, subject_id)
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  registration_number TEXT,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT NOT NULL,
  gender TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS students_institution_active
  ON students(institution_id, is_active, display_name);

CREATE TABLE IF NOT EXISTS class_enrollments (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  start_date TEXT,
  end_date TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, class_id, student_id, start_date)
);

CREATE INDEX IF NOT EXISTS class_enrollments_roster
  ON class_enrollments(institution_id, class_id, end_date);

CREATE TABLE IF NOT EXISTS institution_periods (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 7),
  label TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS institution_periods_schedule
  ON institution_periods(institution_id, weekday, start_time);

CREATE TABLE IF NOT EXISTS teacher_timetables (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  academic_year TEXT,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period_id TEXT NOT NULL REFERENCES institution_periods(id) ON DELETE CASCADE,
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 7),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, class_id, subject_id, teacher_id, period_id)
);

CREATE INDEX IF NOT EXISTS teacher_timetables_monitor
  ON teacher_timetables(institution_id, teacher_id, class_id, period_id);

CREATE TABLE IF NOT EXISTS teacher_absence_requests (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason_label TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_comment TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS teacher_absences_monitor
  ON teacher_absence_requests(institution_id, teacher_id, start_date, end_date, status);

CREATE TABLE IF NOT EXISTS teacher_sessions (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  client_session_id TEXT,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  period_id TEXT REFERENCES institution_periods(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  actual_call_at TEXT,
  ended_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('teacher', 'class_device', 'admin')),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, client_session_id)
);

CREATE INDEX IF NOT EXISTS teacher_sessions_monitor
  ON teacher_sessions(institution_id, started_at, class_id, subject_id, teacher_id);

CREATE TABLE IF NOT EXISTS attendance_marks (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES teacher_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  late_minutes INTEGER CHECK (late_minutes IS NULL OR late_minutes >= 0),
  comment TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, session_id, student_id)
);

CREATE TABLE IF NOT EXISTS grade_periods (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  label TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS grade_evaluations (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  grade_period_id TEXT REFERENCES grade_periods(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  evaluation_date TEXT,
  max_score REAL NOT NULL DEFAULT 20 CHECK (max_score > 0),
  coefficient REAL NOT NULL DEFAULT 1 CHECK (coefficient > 0),
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS grade_evaluations_lookup
  ON grade_evaluations(institution_id, class_id, subject_id, grade_period_id);

CREATE TABLE IF NOT EXISTS student_grades (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  evaluation_id TEXT NOT NULL REFERENCES grade_evaluations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  score REAL,
  comment TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, evaluation_id, student_id)
);

CREATE TABLE IF NOT EXISTS textbook_assignments (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  source_document_json TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS textbook_items (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES textbook_assignments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  content TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS textbook_sessions (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  client_session_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES textbook_assignments(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES textbook_items(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  session_title TEXT NOT NULL,
  session_date TEXT NOT NULL,
  period_id TEXT REFERENCES institution_periods(id) ON DELETE SET NULL,
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
  UNIQUE (institution_id, client_session_id)
);

CREATE TABLE IF NOT EXISTS textbook_completions (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES textbook_assignments(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES textbook_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'reopened')),
  note TEXT,
  completed_at TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (institution_id, assignment_id, item_id)
);

CREATE TABLE IF NOT EXISTS offline_documents (
  id TEXT PRIMARY KEY,
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
  UNIQUE (institution_id, sha256)
);

CREATE TABLE IF NOT EXISTS sync_records (
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  local_dirty INTEGER NOT NULL DEFAULT 0 CHECK (local_dirty IN (0, 1)),
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  operation_id TEXT PRIMARY KEY,
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
  UNIQUE (institution_id, operation_id)
);

CREATE INDEX IF NOT EXISTS sync_outbox_ready
  ON sync_outbox(institution_id, state, next_attempt_at, occurred_at);

CREATE INDEX IF NOT EXISTS sync_outbox_entity
  ON sync_outbox(institution_id, entity_type, entity_id, state);

CREATE TABLE IF NOT EXISTS sync_inbox (
  event_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
  server_version INTEGER NOT NULL CHECK (server_version >= 0),
  payload_json TEXT,
  occurred_at TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE (institution_id, event_id)
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  stream TEXT NOT NULL,
  cursor TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  PRIMARY KEY (institution_id, stream)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
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
  UNIQUE (institution_id, event_id)
);

CREATE INDEX IF NOT EXISTS sync_conflicts_unresolved
  ON sync_conflicts(institution_id, resolved_at, detected_at);

CREATE TABLE IF NOT EXISTS relay_devices (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('relay', 'admin_desktop', 'teacher_device', 'class_device')),
  public_key TEXT,
  token_hash TEXT,
  paired_at TEXT,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (institution_id, id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  actor_profile_id TEXT,
  device_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_institution_time
  ON audit_log(institution_id, occurred_at DESC);
