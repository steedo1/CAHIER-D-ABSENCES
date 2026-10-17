import assert from "node:assert/strict";
import test from "node:test";
import { prepareSchoolTeachingImport, type TeachingImportCatalog } from "../src/lib/school-teaching-import";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";
const subject = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const school = parseSchoolCyclesSettings({ school_cycles_v1: { version: 1, enabled: true,
  enabledCycles: ["primary"], teachingTracksByCycle: { primary: ["french", "arabic"] },
  subjectTracksByCycle: { primary: { [subject]: ["french"], [second]: ["arabic"] } } } });
const catalog: TeachingImportCatalog = {
  teachers: [{ id: "t1", name: "Enseignant fictif" }],
  subjects: [{ id: subject, name: "Matière F" }, { id: second, name: "Matière A" }],
  classes: [{ id: "c1", label: "CP1 A", level: "CP1" }, { id: "c2", label: "CP2 A", level: "CP2" }],
  assignments: [{ teacher_id: "t1", subject_id: subject, class_id: "c1" }],
};

test("canonical and institution subject ids identify the same existing assignment", () => {
  const scopedCatalog = structuredClone(catalog);
  scopedCatalog.subjects[0].institutionSubjectId = "institution-subject-1";
  scopedCatalog.assignments[0].subject_id = "institution-subject-1";
  const rows = [{ teacherId: "t1", subjectId: subject, classId: "c1", track: "french" as const },
    { teacherId: "t1", subjectId: "institution-subject-1", classId: "c2", track: "french" as const }];
  const plan = prepareSchoolTeachingImport(rows, school, scopedCatalog);
  assert.equal(plan.existingAssignments, 1); assert.equal(plan.proposedAssignments, 1);
  assert.equal(plan.items[1].subjectId, subject);
  assert.equal(plan.needsReview, 0);
});

test("one teacher can retain existing links and gain multiple classes and subjects without duplicate accounts", () => {
  const rows = [{ teacherId: "t1", subjectId: subject, classId: "c1", track: "french" as const },
    { teacherId: "t1", subjectId: subject, classId: "c2", track: "french" as const },
    { teacherId: "t1", subjectId: second, classId: "c2", track: "arabic" as const }];
  const plan = prepareSchoolTeachingImport(rows, school, catalog);
  assert.equal(plan.existingAssignments, 1);
  assert.equal(plan.proposedAssignments, 2);
  assert.equal(plan.needsReview, 0);
  assert.equal(plan.canApply, false);
  assert.equal(catalog.assignments.length, 1);
  assert.equal(catalog.teachers.length, 1);
});

test("missing, ambiguous and other-institution references need review without inventing data", () => {
  const plan = prepareSchoolTeachingImport([
    { teacherId: "foreign-teacher", subjectId: subject, classId: "c1", track: "french" },
    { teacherName: "Homonyme", subjectId: subject, classId: "c1", track: "french" },
    { teacherId: "t1", subjectId: subject, classId: "foreign-class", track: "french" },
    { teacherId: "t1", subjectId: subject, classId: "c1" },
    { teacherId: "t1", subjectId: subject, classId: "c1", track: "arabic" },
  ], school, { ...catalog, teachers: [...catalog.teachers, { id: "t2", name: "Homonyme" }, { id: "t3", name: "Homonyme" }] });
  assert.equal(plan.needsReview, 5);
  assert.equal(plan.proposedAssignments, 0);
});

test("a teaching group cannot be invented as a second physical class", () => {
  const plan = prepareSchoolTeachingImport([{ teacherId: "t1", subjectId: second, classLabel: "CP1 arabe", track: "arabic" }], school, catalog);
  assert.ok(plan.items[0].issues.includes("class_missing_or_ambiguous"));
});

test("duplicate rows and shared-subject assignments cannot cause duplicate physical links", () => {
  const row = { teacherId: "t1", subjectId: subject, classId: "c2", track: "french" as const };
  assert.ok(prepareSchoolTeachingImport([row, row], school, catalog).items[1].issues.includes("duplicate_import_row"));
  const shared = structuredClone(school);
  shared.subjectTracksByCycle.primary![subject] = ["french", "arabic"];
  assert.ok(prepareSchoolTeachingImport([row], shared, catalog).items[0].issues.includes("shared_subject_requires_program_assignment_schema"));
});
