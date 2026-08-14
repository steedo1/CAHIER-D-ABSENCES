ALTER TABLE grade_periods ADD COLUMN code TEXT;
ALTER TABLE grade_periods ADD COLUMN short_label TEXT;
ALTER TABLE grade_periods ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE grade_periods ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE grade_periods ADD COLUMN kind TEXT;
ALTER TABLE grade_periods ADD COLUMN academic_year_id TEXT;
ALTER TABLE grade_periods ADD COLUMN coeff REAL NOT NULL DEFAULT 1 CHECK (coeff > 0);
ALTER TABLE grade_periods ADD COLUMN scope_type TEXT;
ALTER TABLE grade_periods ADD COLUMN education_type TEXT;
ALTER TABLE grade_periods ADD COLUMN formation_code TEXT;
ALTER TABLE grade_periods ADD COLUMN display_code TEXT;
ALTER TABLE grade_periods ADD COLUMN profile_period_key TEXT;

ALTER TABLE grade_evaluations ADD COLUMN eval_kind TEXT;
ALTER TABLE grade_evaluations ADD COLUMN academic_year TEXT;
ALTER TABLE grade_evaluations ADD COLUMN academic_year_id TEXT;
ALTER TABLE grade_evaluations ADD COLUMN subject_component_id TEXT;
ALTER TABLE grade_evaluations ADD COLUMN grading_period_id TEXT;
ALTER TABLE grade_evaluations ADD COLUMN publication_status TEXT;
ALTER TABLE grade_evaluations ADD COLUMN publication_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE grade_evaluations ADD COLUMN published_at TEXT;
ALTER TABLE grade_evaluations ADD COLUMN submitted_at TEXT;
ALTER TABLE grade_evaluations ADD COLUMN submitted_by TEXT;
ALTER TABLE grade_evaluations ADD COLUMN reviewed_at TEXT;
ALTER TABLE grade_evaluations ADD COLUMN reviewed_by TEXT;
ALTER TABLE grade_evaluations ADD COLUMN review_comment TEXT;

ALTER TABLE student_grades ADD COLUMN updated_by TEXT;

ALTER TABLE students ADD COLUMN birthdate TEXT;
ALTER TABLE students ADD COLUMN birth_place TEXT;
ALTER TABLE students ADD COLUMN nationality TEXT;
ALTER TABLE students ADD COLUMN regime TEXT;
ALTER TABLE students ADD COLUMN is_repeater INTEGER NOT NULL DEFAULT 0 CHECK (is_repeater IN (0, 1));
ALTER TABLE students ADD COLUMN is_boarder INTEGER NOT NULL DEFAULT 0 CHECK (is_boarder IN (0, 1));
ALTER TABLE students ADD COLUMN is_affecte INTEGER NOT NULL DEFAULT 0 CHECK (is_affecte IN (0, 1));
ALTER TABLE students ADD COLUMN lv2 TEXT;
ALTER TABLE students ADD COLUMN lifecycle_status TEXT;

ALTER TABLE classes ADD COLUMN code TEXT;
ALTER TABLE classes ADD COLUMN head_teacher_id TEXT;
ALTER TABLE classes ADD COLUMN official_track_code TEXT;
ALTER TABLE classes ADD COLUMN education_type TEXT;
ALTER TABLE classes ADD COLUMN formation_code TEXT;
ALTER TABLE classes ADD COLUMN formation_level_code TEXT;

ALTER TABLE class_enrollments ADD COLUMN official_track_code TEXT;

CREATE TABLE class_teachers (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  subject_id TEXT,
  teacher_id TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id),
  FOREIGN KEY (institution_id, teacher_id) REFERENCES profiles(institution_id, id)
);

CREATE INDEX class_teachers_lookup
  ON class_teachers(institution_id, class_id, teacher_id, subject_id);

CREATE TABLE educator_class_assignments (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  level TEXT NOT NULL,
  class_id TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, profile_id) REFERENCES profiles(institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id)
);

CREATE TABLE institution_level_subjects (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  education_type TEXT NOT NULL,
  formation_code TEXT NOT NULL,
  level_code TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id)
);

CREATE TABLE institution_subject_coeffs (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  level TEXT,
  subject_id TEXT NOT NULL,
  coeff REAL NOT NULL DEFAULT 1 CHECK (coeff > 0),
  include_in_average INTEGER NOT NULL DEFAULT 1 CHECK (include_in_average IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id)
);

CREATE INDEX institution_subject_coeffs_lookup
  ON institution_subject_coeffs(institution_id, level, subject_id);

CREATE TABLE institution_subject_grade_policies (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  include_in_general_average INTEGER NOT NULL DEFAULT 1 CHECK (include_in_general_average IN (0, 1)),
  include_in_conduct_average INTEGER NOT NULL DEFAULT 0 CHECK (include_in_conduct_average IN (0, 1)),
  conduct_weight REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id)
);

CREATE TABLE grade_subject_components (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  short_label TEXT,
  coeff_in_subject REAL NOT NULL DEFAULT 1 CHECK (coeff_in_subject > 0),
  order_index INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  level TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id)
);

CREATE TABLE grade_published_scores (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  subject_id TEXT,
  subject_component_id TEXT,
  teacher_id TEXT,
  eval_date TEXT NOT NULL,
  eval_kind TEXT NOT NULL,
  score REAL,
  scale REAL NOT NULL CHECK (scale > 0),
  coeff REAL NOT NULL CHECK (coeff > 0),
  publication_version INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  published_at TEXT NOT NULL,
  published_by TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, evaluation_id) REFERENCES grade_evaluations(institution_id, id),
  FOREIGN KEY (institution_id, student_id) REFERENCES students(institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id)
);

CREATE INDEX grade_published_scores_current
  ON grade_published_scores(institution_id, class_id, student_id, is_current);

CREATE TABLE grade_publication_events (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  evaluation_id TEXT NOT NULL,
  actor_profile_id TEXT,
  action TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, evaluation_id) REFERENCES grade_evaluations(institution_id, id)
);

CREATE TABLE grade_adjustments (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  subject_id TEXT,
  student_id TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  grading_period_id TEXT,
  bonus REAL NOT NULL DEFAULT 0,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id),
  FOREIGN KEY (institution_id, student_id) REFERENCES students(institution_id, id)
);

CREATE TABLE grade_evaluation_locks (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  evaluation_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  subject_id TEXT,
  teacher_id TEXT,
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  locked_by TEXT,
  locked_at TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, evaluation_id) REFERENCES grade_evaluations(institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id)
);

CREATE TABLE institution_grade_publication_settings (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  require_admin_validation INTEGER NOT NULL DEFAULT 0 CHECK (require_admin_validation IN (0, 1)),
  auto_push_on_publish INTEGER NOT NULL DEFAULT 0 CHECK (auto_push_on_publish IN (0, 1)),
  sms_digest_mode TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE TABLE bulletin_subject_groups (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  code TEXT,
  label TEXT NOT NULL,
  short_label TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  annual_coeff REAL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE TABLE bulletin_subject_group_items (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  subject_id TEXT,
  institution_subject_id TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  subject_coeff_override REAL,
  is_optional INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, group_id) REFERENCES bulletin_subject_groups(institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id)
);

CREATE TABLE bulletin_nc_overrides (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  scope TEXT NOT NULL,
  is_nc INTEGER NOT NULL DEFAULT 0 CHECK (is_nc IN (0, 1)),
  reason TEXT,
  missing_subjects_snapshot TEXT NOT NULL DEFAULT '[]',
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, student_id) REFERENCES students(institution_id, id)
);

CREATE TABLE core_subject_weights (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  is_exam_core INTEGER NOT NULL DEFAULT 0 CHECK (is_exam_core IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id)
);

CREATE TABLE institution_conduct_policies (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  classic_conduct_weight REAL NOT NULL DEFAULT 0,
  missing_subject_strategy TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE TABLE conduct_settings (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  assiduite_max REAL NOT NULL,
  tenue_max REAL NOT NULL,
  moralite_max REAL NOT NULL,
  discipline_max REAL NOT NULL,
  points_per_absent_hour REAL NOT NULL,
  absent_hours_zero_threshold REAL NOT NULL,
  absent_hours_note_after_threshold REAL,
  lateness_mode TEXT NOT NULL,
  lateness_minutes_per_absent_hour INTEGER NOT NULL,
  lateness_points_per_late REAL NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id)
);

CREATE TABLE conduct_events (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  rubric TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, student_id) REFERENCES students(institution_id, id)
);

CREATE TABLE conduct_penalties (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  subject_id TEXT,
  student_id TEXT NOT NULL,
  rubric TEXT NOT NULL,
  points REAL NOT NULL,
  points_removed REAL NOT NULL DEFAULT 0,
  reason TEXT,
  author_id TEXT,
  author_profile_id TEXT,
  author_role_label TEXT,
  author_subject_name TEXT,
  period_id TEXT,
  occurred_at TEXT NOT NULL,
  client_action_id TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, student_id) REFERENCES students(institution_id, id)
);

CREATE TABLE student_penalties (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  subject_id TEXT,
  teacher_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  rubric TEXT NOT NULL,
  points REAL NOT NULL,
  reason TEXT,
  issued_at TEXT NOT NULL,
  meta TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, subject_id) REFERENCES subjects(institution_id, id),
  FOREIGN KEY (institution_id, teacher_id) REFERENCES profiles(institution_id, id),
  FOREIGN KEY (institution_id, student_id) REFERENCES students(institution_id, id)
);

CREATE TABLE conduct_average_overrides (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  period_code TEXT NOT NULL,
  from_date TEXT,
  to_date TEXT,
  calculated_total REAL NOT NULL,
  override_total REAL NOT NULL,
  reason TEXT,
  edited_by TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, student_id) REFERENCES students(institution_id, id)
);

CREATE TABLE conduct_rubric_overrides (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  period_code TEXT NOT NULL,
  rubric_key TEXT NOT NULL,
  from_date TEXT,
  to_date TEXT,
  calculated_value REAL NOT NULL,
  override_value REAL NOT NULL,
  edited_by TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, class_id) REFERENCES classes(institution_id, id),
  FOREIGN KEY (institution_id, student_id) REFERENCES students(institution_id, id)
);

CREATE TABLE teacher_signatures (
  id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (institution_id, id),
  FOREIGN KEY (institution_id, teacher_id) REFERENCES profiles(institution_id, id)
);

CREATE INDEX academic_grades_lookup
  ON student_grades(institution_id, student_id, evaluation_id);
CREATE INDEX conduct_events_lookup
  ON conduct_events(institution_id, class_id, student_id, occurred_at);
CREATE INDEX conduct_penalties_lookup
  ON conduct_penalties(institution_id, class_id, student_id, occurred_at);
CREATE INDEX student_penalties_lookup
  ON student_penalties(institution_id, class_id, student_id, issued_at);
