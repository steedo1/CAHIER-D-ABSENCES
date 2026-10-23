import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/app/class/page.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/app/api/class/subjects/route.ts", import.meta.url), "utf8");

test("Autre cours is selectable even without a configured slot", () => {
  assert.match(page, /manualSubjectMode\s*\?\s*!!classId && manualDurationValid/);
  assert.match(page, /if \(!activeConfiguredSlot\) \{/);
  assert.match(page, /manual_course:\s*manualSubjectMode/);
  assert.match(page, /const persistedPeriodId = manualSubjectMode\s*\? activeConfiguredSlot\?\.id \|\| null/);
  assert.match(page, /stageTeacherAttendanceSessionOpen\(/);
});

test("exceptional discipline requires explicit selection and no automatic fallback", () => {
  assert.match(page, /if \(manualSubjectMode\) return prev && list\.some/);
  assert.match(page, /manualSubjectMode \|\| subjects\.length > 1/);
  assert.match(page, /chooseCourseMode\(!manualSubjectMode\)/);
  assert.doesNotMatch(page, />\s*Cours prévu\s*</);
  assert.match(page, /manual_course=1/);
});

test("exceptional duration is independent and does not follow scheduled period", () => {
  assert.match(page, /const \[manualDuration, setManualDuration\]/);
  assert.match(page, /let effectiveDuration = manualSubjectMode\s*\? manualDuration/);
  assert.match(page, /min=\{1\}/);
  assert.match(page, /max=\{240\}/);
  assert.match(page, /manualSubjectMode && !manualDurationValid/);
  assert.match(page, /actualCallAtISO = observedAt\.toISOString\(\)/);
});

test("exceptional subject endpoint filters current teacher assignments without scanning marks", () => {
  const branchStart = api.indexOf("if (manualCourse) {", api.indexOf("// Voie exceptionnelle explicite"));
  const branchEnd = api.indexOf("// 2) Sans créneau demandé", branchStart);
  assert.ok(branchStart > 0 && branchEnd > branchStart);
  const manual = api.slice(branchStart, branchEnd);
  assert.match(manual, /\.from\("class_teachers"\)/);
  assert.match(manual, /\.eq\("institution_id", institutionId\)/);
  assert.match(manual, /\.eq\("class_id", class_id\)/);
  assert.match(manual, /teachers\.size === 1/);
  assert.match(manual, /return scheduleJson/);
  assert.doesNotMatch(manual, /grade_flat_marks/);
  assert.doesNotMatch(manual, /teacher_timetables/);
});

test("Cloud + PWA remain the only new-call path; legacy pending operations stay untouched", () => {
  const flags = readFileSync(new URL("../src/lib/relay-capability.ts", import.meta.url), "utf8");
  const provider = readFileSync(new URL("../src/components/RelayCapabilityProvider.tsx", import.meta.url), "utf8");
  const readiness = readFileSync(new URL("../src/lib/offline-readiness.ts", import.meta.url), "utf8");
  const legacy = readFileSync(new URL("../src/lib/teacher-session-delivery.ts", import.meta.url), "utf8");

  assert.match(flags, /export const RELAY_LOCAL_DISABLED = true/);
  assert.match(flags, /!RELAY_LOCAL_DISABLED && readRelayCapability/);
  assert.match(provider, /const nextRelayEnabled = !RELAY_LOCAL_DISABLED &&/);
  assert.match(provider, /!RELAY_LOCAL_DISABLED && \(/);
  assert.match(page, /const relayDelivery = relayUiEnabled\s*\? await openTeacherAttendanceSessionOnRelay/);
  assert.match(page, /: null;\s*const relayAttemptDuration/);
  assert.match(readiness, /if \(RELAY_LOCAL_DISABLED\) throw cloudError/);
  assert.match(readiness, /const context = RELAY_LOCAL_DISABLED\s*\? null/);
  assert.match(readiness, /let lastSourceError: unknown = RELAY_LOCAL_DISABLED \? null : accessError/);
  assert.match(readiness, /if \(!RELAY_LOCAL_DISABLED && relayPolicy\)/);
  assert.match(readiness, /existingBundle!\.schedule/);
  assert.match(page, /stageTeacherAttendanceSessionOpen\(/);
  assert.match(page, /offlineMutateJson<\{/);
  assert.match(legacy, /async function getOrCreateRecord/);
});
