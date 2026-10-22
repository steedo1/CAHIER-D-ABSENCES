import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/app/grades/class-device/page.tsx", import.meta.url), "utf8");
const teacherPage = readFileSync(new URL("../src/app/grades/page.tsx", import.meta.url), "utf8");

test("EPC PWA deletion uses a visible confirmation, not native confirm", () => {
  assert.doesNotMatch(page, /window\.confirm\(/, "native confirm is unreliable in installed PWAs");
  assert.match(page, /role="dialog" aria-modal="true" aria-labelledby="confirm-grade-delete-title"/);
  assert.match(page, /onClick=\{\(\) => void deleteEvaluation\(deleteTarget\)\}/);
  assert.match(page, /onClick=\{\(\) => requestDeleteEvaluation\(currentActiveEval\)\}/);
});

test("EPC deletion never presents an optimistic success on HTTP failure", () => {
  assert.match(page, /if \(!r\.ok \|\| !j\?\.ok\)/);
  assert.match(page, /setDeleteError\(errorText\)/);
  assert.match(page, /Suppression non effectuée : \{deleteError\}/);
});

test("EPC deletion clears only class-device evaluation and score caches after cloud OK", () => {
  const success = page.indexOf('if (!r.ok || !j?.ok)');
  const invalidation = page.indexOf('await cacheDeleteByPrefixes([');
  assert.ok(success >= 0 && invalidation > success, "cache purge happens only after confirmed success");
  assert.match(page, /gradesEvaluationsKey\(/);
  assert.match(page, /gradesScoresKey\("class-device", ev\.id\)/);
  assert.match(page, /setActiveEvalId\(\(prev\) => prev === ev\.id \? null : prev\)/);
});

test("Mobile class-device gradebook keeps deletion visible for secondary and primary columns", () => {
  assert.match(page, /\{isMobile && currentActiveEval && selected\?\.school_cycle !== "preschool" && \(/);
  assert.doesNotMatch(page, /isMobile && isPrimaryProgram && primaryCatalogEnabled && currentActiveEval &&/);
  assert.match(page, /disabled=\{!isOnline \|\| selectedPeriodClosed \|\| !isEvaluationDeletable\(currentActiveEval\)/);
  assert.match(page, /Suppression bloquée : note soumise ou publiée/);
});

test("Mobile teacher gradebook restores deletion with PWA-safe confirmation", () => {
  assert.match(teacherPage, /\{isMobile && currentActiveEval && !isPreschoolProgram && \(/);
  assert.match(teacherPage, /onClick=\{\(\) => requestDeleteEvaluation\(currentActiveEval\)\}/);
  assert.match(teacherPage, /!isEvaluationDeletableForTeacher\(currentActiveEval\)/);
  assert.doesNotMatch(teacherPage, /window\.confirm\(/);
  assert.match(teacherPage, /role="dialog" aria-modal="true" aria-labelledby="confirm-teacher-grade-delete-title"/);
  assert.match(teacherPage, /onClick=\{\(\) => void deleteEvaluation\(deleteTarget\)\}/);
  assert.match(teacherPage, /if \(!r\.ok \|\| !j\?\.ok\)/);
  assert.match(teacherPage, /setDeleteError\(errorText\)/);
});
