import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateTeacherClassOptions } from "../src/lib/grades/teacher-class-options";

const year = "2026-2027";

test("teacher filter removes repeated class-subject assignments without inventing subjects", () => {
  const items = [
    { class_id: "3e1", subject_id: "edhc", academic_year: year, teaching_track: null, class_label: "3e1", subject_name: "EDHC" },
    { class_id: "3e2", subject_id: "math", academic_year: year, teaching_track: null, class_label: "3e2", subject_name: "Mathématiques" },
    { class_id: "3e1", subject_id: "edhc", academic_year: year, teaching_track: null, class_label: "3e1", subject_name: "EDHC" },
    { class_id: "3e2", subject_id: "math", academic_year: year, teaching_track: null, class_label: "3e2", subject_name: "Mathématiques" },
  ];
  assert.deepEqual(deduplicateTeacherClassOptions(items).map(item => [item.class_label, item.subject_name]), [
    ["3e1", "EDHC"],
    ["3e2", "Mathématiques"],
  ]);
});

test("teacher filter preserves distinct subjects, school years and primary tracks", () => {
  const items = [
    { class_id: "cp1", subject_id: "math", academic_year: year, teaching_track: "french" },
    { class_id: "cp1", subject_id: "math", academic_year: year, teaching_track: "arabic" },
    { class_id: "cp1", subject_id: "arabic", academic_year: year, teaching_track: "arabic" },
    { class_id: "cp1", subject_id: "math", academic_year: "2025-2026", teaching_track: "french" },
  ];
  assert.equal(deduplicateTeacherClassOptions(items).length, 4);
});
