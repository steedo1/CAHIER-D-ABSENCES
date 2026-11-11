import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("la reprise espace les échecs et réagit immédiatement au retour du réseau", async () => {
  let effect, interval, wake, now = 1_000_000, attempts = 0, successful = false;
  const listeners = new Map();
  const docListeners = new Map();
  const source = ts.transpileModule(fs.readFileSync(new URL("../src/components/BackgroundAttendanceDeliverySync.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const mocks = {
    react: { useEffect: fn => { effect = fn; } },
    "@/lib/teacher-attendance-cloud-sync": { syncTeacherAttendanceOperationsToCloud: async () => {
      attempts++;
      return { remaining: successful ? 0 : 3, flushed: successful ? 3 : 0, retryableFailure: !successful };
    } },
    "@/lib/teacher-attendance-relay-sync": { syncDurableAttendanceOperationsToRelay: () => { throw new Error("relais désactivé"); } },
    "@/lib/relay-capability": { RELAY_LOCAL_DISABLED: true },
  };
  vm.runInNewContext(source, {
    exports, require: name => mocks[name],
    Date: class extends Date { static now() { return now; } },
    window: {
      setTimeout: fn => { wake = fn; return 1; }, clearTimeout() {},
      setInterval: fn => { interval = fn; return 2; }, clearInterval() {},
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {},
    },
    document: { visibilityState: "visible", addEventListener: (name, fn) => docListeners.set(name, fn), removeEventListener() {} },
  });
  exports.default();
  const cleanup = effect();
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
  wake(); await settle();
  assert.equal(attempts, 1);
  now += 20_000; interval(); await settle();
  assert.equal(attempts, 2);
  now += 20_000; interval(); await settle();
  assert.equal(attempts, 2, "le minuteur ne contourne pas le délai progressif");
  listeners.get("online")(); wake(); await settle();
  assert.equal(attempts, 3, "retour réseau sans attendre le délai précédent");
  now += 20_000; interval(); await settle();
  assert.equal(attempts, 4);
  successful = true;
  docListeners.get("visibilitychange")(); wake(); await settle();
  assert.equal(attempts, 5, "réouverture de la PWA : reprise immédiate");
  cleanup(); interval(); await settle();
  assert.equal(attempts, 5, "aucun envoi après démontage");
});
