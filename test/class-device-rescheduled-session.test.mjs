import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", "require", compile(read("src/lib/teacher-session-delivery.ts")))(exports, (name) => {
  if (name === "@/lib/offline") return {};
  if (name === "@/lib/attendance-network") return {};
  if (name === "@/lib/local-relay") return {};
  if (name === "@/lib/teacher-session-protocol") return {};
  throw new Error(name);
});

// Execute the actual page's key construction, so changing only the journal
// without wiring the planned start into the class flow cannot pass this test.
function keys(plannedStart, manualSubjectMode = false) {
  const block = read("src/app/class/page.tsx").match(/const (?:legacyAttemptKey|attemptKey) = \[[\s\S]*?(?=\n\s*const institutionId =)/)?.[0];
  assert.ok(block);
  return new Function("classId", "deliveryPeriodKey", "subjectId", "dateKey", "manualSubjectMode", "started", compile(
    `${block}; return { attemptKey, legacyAttemptKey: typeof legacyAttemptKey === "undefined" ? attemptKey : legacyAttemptKey };`,
  ))("3e1", manualSubjectMode ? `manual:outside:${plannedStart}` : "same-period-id", "allemand", "2026-10-08", manualSubjectMode, new Date(plannedStart));
}

function fixture() {
  const records = [];
  let operation = 0;
  const deps = {
    now: () => new Date("2026-10-08T04:50:12.000Z"),
    createOperationId: () => `opening-${++operation}`,
    store: {
      list: async () => structuredClone(records),
      put: async (record) => {
        const index = records.findIndex((item) => item.operation_id === record.operation_id);
        if (index < 0) records.push(structuredClone(record));
        else records[index] = structuredClone(record);
      },
    },
  };
  const input = (start, extra = {}) => ({
    institutionId: "csca", classId: "3e1", subjectId: "allemand", periodId: "same-period-id",
    ...keys(start),
    classStart: {
      period_id: "same-period-id", expected_minutes: 2,
      actual_call_at: new Date(Date.parse(start) + 12_000).toISOString(), manual_course: false,
      planned_start_at: start, planned_end_at: new Date(Date.parse(start) + 120_000).toISOString(),
    }, ...extra,
  });
  const stage = (value) => exports.stageTeacherAttendanceSessionOpenWithDependencies(value, deps);
  return { records, deps, input, stage };
}

test("moving the same class period from 03:20 to 04:50 creates a new session and preserves the real click", async () => {
  const f = fixture();
  const first = await f.stage(f.input("2026-10-08T03:20:00.000Z"));
  f.records[0] = { ...first, state: "cloud_opened", session_id: "old-closed-session", started_at: "2026-10-08T03:20:00.000Z" };
  const old = structuredClone(f.records[0]);
  const moved = await f.stage(f.input("2026-10-08T04:50:00.000Z"));
  assert.notEqual(moved.operation_id, first.operation_id);
  assert.equal(moved.session_id, null);
  assert.equal(moved.actual_call_at, "2026-10-08T04:50:12.000Z");
  assert.deepEqual(f.records[0], old);
  assert.equal((await f.stage(f.input("2026-10-08T04:50:00.000Z"))).operation_id, moved.operation_id);
});

for (const state of ["device_pending", "cloud_opened"]) {
  test(`an existing ${state} legacy call on the same slot keeps its original operation and payload`, async () => {
    const f = fixture(), value = f.input("2026-10-08T04:50:00.000Z");
    const first = await f.stage({ ...value, attemptKey: value.legacyAttemptKey, legacyAttemptKey: undefined });
    f.records[0] = { ...first, state, started_at: state === "cloud_opened" ? "2026-10-08T04:50:00.000Z" : null,
      session_id: state === "cloud_opened" ? "existing-session" : null };
    const migrated = await f.stage({ ...value, classStart: { ...value.classStart, actual_call_at: "2026-10-08T04:50:39.000Z" } });
    assert.equal(migrated.operation_id, first.operation_id);
    assert.equal(migrated.actual_call_at, "2026-10-08T04:50:12.000Z");
    assert.deepEqual(migrated.class_start, first.class_start);
    assert.equal(f.records.length, 1);
    assert.equal((await f.stage(value)).operation_id, first.operation_id);
  });
}

test("a legacy pending call captured on the old slot cannot be reused on the moved slot", async () => {
  const f = fixture(), oldInput = f.input("2026-10-08T03:20:00.000Z");
  const first = await f.stage({ ...oldInput, attemptKey: oldInput.legacyAttemptKey, legacyAttemptKey: undefined });
  const moved = await f.stage(f.input("2026-10-08T04:50:00.000Z"));
  assert.notEqual(moved.operation_id, first.operation_id);
  assert.equal(f.records.length, 2);
});

test("two clicks within the same planned slot keep the same opening ID and first observed time", async () => {
  const f = fixture(), value = f.input("2026-10-08T04:50:00.000Z");
  const first = await f.stage(value);
  const second = await f.stage({ ...value, classStart: { ...value.classStart, actual_call_at: "2026-10-08T04:51:01.000Z" } });
  assert.equal(first.operation_id, second.operation_id);
  assert.equal(second.actual_call_at, first.actual_call_at);
});

test("manual courses continue to use their own actual start identity", () => {
  assert.notEqual(keys("2026-10-08T04:45:15.247Z", true).attemptKey, keys("2026-10-08T04:46:14.148Z", true).attemptKey);
});
