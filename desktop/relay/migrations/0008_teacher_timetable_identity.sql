DROP INDEX IF EXISTS teacher_timetables_monitor;

CREATE TABLE __v8_teacher_timetables (
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
  FOREIGN KEY (institution_id, class_id)
    REFERENCES classes(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, subject_id)
    REFERENCES subjects(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, teacher_id)
    REFERENCES profiles(institution_id, id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id, period_id)
    REFERENCES institution_periods(institution_id, id) ON DELETE CASCADE
);

INSERT INTO __v8_teacher_timetables(
  id, institution_id, academic_year, class_id, subject_id, teacher_id,
  period_id, weekday, server_version, updated_at, deleted_at
)
SELECT
  id, institution_id, academic_year, class_id, subject_id, teacher_id,
  period_id, weekday, server_version, updated_at, deleted_at
FROM teacher_timetables;

DROP TABLE teacher_timetables;
ALTER TABLE __v8_teacher_timetables RENAME TO teacher_timetables;

CREATE INDEX teacher_timetables_monitor
  ON teacher_timetables(
    institution_id, teacher_id, class_id, period_id, weekday, deleted_at
  );
