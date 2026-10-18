import { createPedagogicalFixture } from "./pedagogical-fixture.mjs";
export const cFr = "33333333-3333-4333-8333-333333333333";
export const cAr = "55555555-5555-4555-8555-555555555555";
export const cOther = "66666666-6666-4666-8666-666666666666";
export const subject = "11111111-1111-4111-8111-111111111111";
export const period = "44444444-4444-4444-8444-444444444444";
export function setupComponents(cycle = "secondary", level = "6e") {
  const db = createPedagogicalFixture({ count: 1 });
  const settings = db.tables.institutions[0].settings_json;
  settings.school_cycles_v1 = { version: 1, enabled: true, enabledCycles: [cycle], defaultView: "all",
    classCycleById: { [cFr]: cycle, [cAr]: cycle, [cOther]: cycle },
    teachingTracksByCycle: { [cycle]: ["french", "arabic"] },
    subjectTracksByCycle: { [cycle]: { [subject]: ["french", "arabic"] } } };
  settings.school_student_programs_v1 = { version: 1, years: { "2026-2027": { classes: {
    [cFr]: { tracks: ["french"], students: {} }, [cAr]: { tracks: ["arabic"], students: {} },
    [cOther]: { tracks: ["arabic"], students: {} },
  } } } };
  settings.school_class_subjects_v1 = { version: 1, years: { "2026-2027": { classes: {
    [cFr]: [subject], [cAr]: [subject], [cOther]: [subject],
  } } } };
  settings.franco_arabic_reports_v1 = { version: 1, enabled: true, engine: "specialized", coefficientSource: "program", format: "both",
    scales: ["french", "arabic"].flatMap(track => [level, "5e"].map(value => ({ cycle, level: value, track, maxScore: 20 }))),
    coefficients: cycle === "secondary" ? ["french", "arabic"].flatMap(track => [level, "5e"].map(value =>
      ({ cycle, level: value, track, subjectId: subject, coefficient: track === "french" ? 3 : 5, includeInAverage: true }))) : [] };
  db.tables.academic_years = [{ id: "year", institution_id: db.legacyId, code: "2026-2027", is_current: true }];
  db.tables.subjects = [{ id: subject, name: "Mathématiques" }];
  db.tables.institution_subjects = [{ id: "local-subject", institution_id: db.legacyId, subject_id: subject,
    is_active: true, subjects: { name: "Mathématiques" } }];
  const cls = { ...db.tables.classes[0], level };
  db.tables.classes = [ { ...cls, id: cFr, label: "Classe française" }, { ...cls, id: cAr, label: "Classe arabe" },
    { ...cls, id: cOther, level: "5e", label: "Autre niveau" } ];
  db.tables.class_enrollments = [cFr, cAr].map(id => ({ ...db.tables.class_enrollments[0], id: "enrollment-" + id, class_id: id }));
  db.tables.grade_subject_components = [];
  db.tables.institution_subject_coeffs = [{ institution_id: db.legacyId, subject_id: subject, level, coeff: 3 }];
  db.tables.grade_evaluations = []; db.tables.grade_published_scores = []; db.tables.student_grades = [];
  return db;
}
