import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture() {
  let probes = 0;
  const entries = [];
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL("../src/lib/teacher-attendance-cloud-sync.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports = {
    "@/lib/attendance-network": { attendanceCloudAvailableForSync: async () => { probes++; return false; } },
    "@/lib/offline": { cacheGet: async () => [], listOfflineOutboxEntries: async () => entries },
    "@/lib/teacher-attendance-delivery": { createIndexedDbTeacherAttendanceStore: () => ({ list: async () => [] }) },
    "@/lib/teacher-session-delivery": { listTeacherSessionOpenOperations: async () => [] },
    "@/lib/teacher-session-lifecycle-delivery": { listTeacherSessionLifecycleOperations: async () => [] },
  };
  new Function("exports", "require", source)(exports, (name) => imports[name]);
  return { entries, exports, probes: () => probes };
}

test("zéro sondage Cloud quand l'appareil est vide ou ne contient que des opérations bloquées", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = globalThis;
  try {
    const f = fixture();
    assert.equal((await f.exports.syncTeacherAttendanceOperationsToCloud("school")).remaining, 0);
    f.entries.push({ operationId: "legacy-september", operationType: "session-start", state: "blocked", lastError: "relay_configuration_missing" });
    const before = structuredClone(f.entries);
    assert.equal((await f.exports.syncTeacherAttendanceOperationsToCloud("school")).blocked, 1);
    assert.deepEqual(f.entries, before);
    assert.equal(f.probes(), 0);
    f.entries.push({ operationId: "new-call", operationType: "session-start", state: "pending" });
    await f.exports.syncTeacherAttendanceOperationsToCloud("school");
    assert.equal(f.probes(), 1);
  } finally { globalThis.window = previousWindow; }
});
