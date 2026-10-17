import { createMulticycleFixture } from "./multicycle-fixture.mjs";
const french = "11111111-1111-4111-8111-111111111111";
const arabic = "22222222-2222-4222-8222-222222222222";
const classId = "33333333-3333-4333-8333-333333333333";
const periodId = "44444444-4444-4444-8444-444444444444";

export function createPedagogicalFixture({ bilingual = true, specialized = true, count = 2, name = "École fictive" } = {}) {
  const db = createMulticycleFixture(), institutionId = db.legacyId;
  db.tables.institutions[0].name = name;
  db.tables.institutions[0].settings_json = specialized ? {
    school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["primary"],
      teachingTracksByCycle: { primary: bilingual ? ["french", "arabic"] : ["french"] },
      subjectTracksByCycle: { primary: { [french]: ["french"], ...(bilingual ? { [arabic]: ["arabic"] } : {}) } } },
    franco_arabic_reports_v1: { version: 1, enabled: true, engine: "specialized", coefficientSource: "institution", format: bilingual ? "both" : "separate",
      scales: [{ cycle: "primary", level: "CP1", track: "french", maxScore: 10 }, ...(bilingual ? [{ cycle: "primary", level: "CP1", track: "arabic", maxScore: 20 }] : [])], coefficients: [] },
  } : { historical: true };
  db.tables.classes = [{ id: classId, institution_id: institutionId, academic_year: "2026-2027", level: specialized ? "CP1" : "6e", label: "Classe fictive", education_type: "general_secondary" }];
  db.tables.grade_periods = [{ id: periodId, institution_id: institutionId, academic_year: "2026-2027", scope_type: "common", is_active: true,
    start_date: "2026-09-01", end_date: "2026-12-15", code: "T1", label: "Trimestre 1", order_index: 1, coeff: 1 }];
  db.tables.subjects = [{ id: french, name: "Mathématiques" }, ...(bilingual ? [{ id: arabic, name: "Lecture" }] : [])];
  db.tables.institution_subjects = db.tables.subjects.map((subject, index) => ({ id: `institution-subject-${index}`, institution_id: institutionId,
    subject_id: subject.id, is_active: true, subjects: { name: subject.name } }));
  db.tables.institution_subject_coeffs = db.tables.subjects.map(subject => ({ institution_id: institutionId, level: specialized ? "CP1" : "6eme", subject_id: subject.id, coeff: 2, include_in_average: true }));
  db.tables.institution_level_subjects = db.tables.subjects.map((subject, index) => ({ id: `curriculum-${index}`, institution_id: institutionId,
    education_type: "general_secondary", formation_code: null, level_code: "CP1", subject_id: subject.id, is_active: true }));
  db.tables.grade_evaluations = db.tables.subjects.map((subject, index) => ({ id: `evaluation-${index}`, class_id: classId, subject_id: subject.id,
    eval_date: "2026-10-01", scale: index === 0 ? 10 : 20, coeff: 1, is_published: true, publication_status: "published", publication_version: 2, grading_period_id: periodId }));
  db.tables.class_enrollments = Array.from({ length: count }, (_, index) => ({ id: `enrollment-${index}`, institution_id: institutionId, class_id: classId,
    student_id: `student-${index}`, start_date: "2026-09-01", end_date: null, students: { id: `student-${index}`, institution_id: institutionId,
      full_name: `Élève fictif ${index}`, first_name: "Élève", last_name: `Fictif ${index}`, matricule: `TEST-${index}` } }));
  db.tables.grade_published_scores = db.tables.class_enrollments.flatMap((student, studentIndex) => db.tables.grade_evaluations.map((evaluation, index) => ({
    id: `score-${studentIndex}-${index}`, institution_id: institutionId, class_id: classId, student_id: student.student_id, evaluation_id: evaluation.id,
    subject_id: evaluation.subject_id, eval_date: evaluation.eval_date, score: (index === 0 ? 8 : 12) - studentIndex / 10,
    scale: evaluation.scale, coeff: 1, is_current: true, publication_version: 2,
  })));
  return db;
}
