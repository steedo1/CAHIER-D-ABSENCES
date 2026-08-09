import assert from "node:assert/strict";
import { test } from "node:test";

import { attendanceMonitor } from "../src/attendance-monitor.mjs";
import { openRelayDatabase } from "../src/db.mjs";
import { RelayStore } from "../src/store.mjs";

test("le moniteur expose les cours attendus et distingue démarrage et appel validé", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const updatedAt = "2026-07-13T07:00:00.000Z";
  store.ensureInstitution("inst-1", "Collège test", updatedAt);

  db.prepare(`INSERT INTO subjects(id,institution_id,name,updated_at)
              VALUES ('math','inst-1','Mathématiques',?)`).run(updatedAt);
  db.prepare(`
    INSERT INTO institution_periods(id,institution_id,weekday,label,start_time,end_time,updated_at)
    VALUES ('p1','inst-1',1,'Cours 1','08:00:00','09:00:00',?)
  `).run(updatedAt);

  for (const suffix of ["expected", "started", "called"]) {
    db.prepare(`INSERT INTO classes(id,institution_id,academic_year,label,updated_at)
                VALUES (?, 'inst-1', '2026-2027', ?, ?)`).run(
      `class-${suffix}`,
      `Classe ${suffix}`,
      updatedAt,
    );
    db.prepare(`INSERT INTO profiles(id,institution_id,display_name,updated_at)
                VALUES (?, 'inst-1', ?, ?)`).run(
      `teacher-${suffix}`,
      `Prof ${suffix}`,
      updatedAt,
    );
    db.prepare(`
      INSERT INTO teacher_timetables(
        id,institution_id,class_id,subject_id,teacher_id,period_id,weekday,updated_at
      ) VALUES (?, 'inst-1', ?, 'math', ?, 'p1', 1, ?)
    `).run(
      `tt-${suffix}`,
      `class-${suffix}`,
      `teacher-${suffix}`,
      updatedAt,
    );
  }

  db.prepare(`
    INSERT INTO teacher_sessions(
      id,institution_id,class_id,subject_id,teacher_id,period_id,started_at,
      actual_call_at,origin,updated_at
    ) VALUES ('session-started','inst-1','class-started','math','teacher-started','p1',
              '2026-07-13T08:02:00.000Z',NULL,'teacher',?)
  `).run(updatedAt);
  db.prepare(`
    INSERT INTO teacher_sessions(
      id,institution_id,class_id,subject_id,teacher_id,period_id,started_at,
      actual_call_at,origin,updated_at
    ) VALUES ('session-called','inst-1','class-called','math','teacher-called','p1',
              '2026-07-13T08:01:00.000Z','2026-07-13T08:05:00.000Z','teacher',?)
  `).run(updatedAt);

  const legacy = attendanceMonitor(db, {
    institutionId: "inst-1",
    from: "2026-07-13",
    to: "2026-07-13",
    now: new Date("2026-07-13T08:05:00.000Z"),
  });
  assert.equal(legacy.some((row) => row.class_label === "Classe expected"), false);
  assert.equal(
    legacy.find((row) => row.class_label === "Classe started")?.status,
    "ok",
  );

  const beforeThreshold = attendanceMonitor(db, {
    institutionId: "inst-1",
    from: "2026-07-13",
    to: "2026-07-13",
    now: new Date("2026-07-13T08:05:00.000Z"),
    includeExpectedStatuses: true,
  });
  const statusBefore = new Map(
    beforeThreshold.map((row) => [row.class_label, row.status]),
  );
  assert.equal(statusBefore.get("Classe expected"), "not_started");
  assert.equal(statusBefore.get("Classe started"), "started");
  assert.equal(statusBefore.get("Classe called"), "ok");

  const afterThreshold = attendanceMonitor(db, {
    institutionId: "inst-1",
    from: "2026-07-13",
    to: "2026-07-13",
    now: new Date("2026-07-13T08:20:00.000Z"),
    includeExpectedStatuses: true,
  });
  const statusAfter = new Map(afterThreshold.map((row) => [row.class_label, row.status]));
  assert.equal(statusAfter.get("Classe expected"), "missing");
  assert.equal(statusAfter.get("Classe started"), "started");
  assert.equal(statusAfter.get("Classe called"), "ok");

  db.close();
});

test("deux cours successifs ne réutilisent pas le démarrage du cours suivant", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const updatedAt = "2026-07-13T07:00:00.000Z";
  store.ensureInstitution("inst-1", "Collège test", updatedAt);
  db.prepare(`INSERT INTO classes(id,institution_id,academic_year,label,updated_at)
              VALUES ('class-1','inst-1','2026-2027','4e A',?)`).run(updatedAt);
  db.prepare(`INSERT INTO subjects(id,institution_id,name,updated_at)
              VALUES ('math','inst-1','Mathématiques',?)`).run(updatedAt);
  db.prepare(`INSERT INTO profiles(id,institution_id,display_name,updated_at)
              VALUES ('teacher-1','inst-1','Mme Test',?)`).run(updatedAt);
  db.prepare(`
    INSERT INTO institution_periods(id,institution_id,weekday,label,start_time,end_time,updated_at)
    VALUES ('p1','inst-1',1,'Cours 1','08:00:00','09:00:00',?),
           ('p2','inst-1',1,'Cours 2','09:00:00','10:00:00',?)
  `).run(updatedAt, updatedAt);
  db.prepare(`
    INSERT INTO teacher_timetables(
      id,institution_id,class_id,subject_id,teacher_id,period_id,weekday,updated_at
    ) VALUES ('tt-1','inst-1','class-1','math','teacher-1','p1',1,?),
             ('tt-2','inst-1','class-1','math','teacher-1','p2',1,?)
  `).run(updatedAt, updatedAt);
  db.prepare(`
    INSERT INTO teacher_sessions(
      id,institution_id,class_id,subject_id,teacher_id,period_id,started_at,
      actual_call_at,origin,updated_at
    ) VALUES ('session-2','inst-1','class-1','math','teacher-1','p2',
              '2026-07-13T09:02:00.000Z',NULL,'teacher',?)
  `).run(updatedAt);

  const rows = attendanceMonitor(db, {
    institutionId: "inst-1",
    from: "2026-07-13",
    to: "2026-07-13",
    now: new Date("2026-07-13T09:05:00.000Z"),
    includeExpectedStatuses: true,
  });
  assert.equal(rows.find((row) => row.period_label === "Cours 1")?.status, "missing");
  assert.equal(rows.find((row) => row.period_label === "Cours 2")?.status, "started");

  db.close();
});
