import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../src/components/teacher/TeacherDashboard.tsx", import.meta.url),
  "utf8",
);
const recovery = await readFile(
  new URL("../src/lib/teacher-offline-relay-recovery.ts", import.meta.url),
  "utf8",
);
const lifecycle = await readFile(
  new URL("../src/lib/teacher-session-lifecycle-delivery.ts", import.meta.url),
  "utf8",
);

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `section absente: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `fin de section absente: ${end}`);
  return source.slice(from, to);
}

test("le bouton de synchronisation essaie le relais avant de sonder le Cloud", () => {
  const syncNow = section(page, "async function syncNow()", "syncNowRef.current = syncNow");
  assert.match(syncNow, /recoverTeacherOfflineOperationsToRelay\(/);
  assert.match(syncNow, /cloudAvailable = await teacherSessionCloudAvailable\(\)/);
  assert.ok(
    syncNow.indexOf("recoverTeacherOfflineOperationsToRelay(") <
      syncNow.indexOf("teacherSessionCloudAvailable()"),
  );
  assert.doesNotMatch(syncNow, /Hors connexion : synchronisation impossible/);
  assert.match(syncNow, /if \(cloudAvailable\) \{[\s\S]*flushOutbox\(\)/);
});

test("le relais est réessayé périodiquement même sans événement online", () => {
  assert.match(page, /window\.setInterval\(retryRelay, 20_000\)/);
  assert.match(page, /document\.addEventListener\("visibilitychange", retryRelay\)/);
  assert.match(page, /void syncNowRef\.current\(\)/);
  assert.match(page, /Le relais LAN peut revenir sans événement navigateur/);
});

test("la récupération respecte l'ordre ouverture active puis appel puis fermeture puis transition", () => {
  assert.match(recovery, /activeLocalSessionIds/);
  assert.match(recovery, /opens_waiting_for_user/);
  assert.match(recovery, /for \(const record of sorted\([\s\S]*opens\.filter/);
  assert.match(recovery, /for \(const record of sorted\(attendance\)\)/);
  assert.match(recovery, /for \(const record of closes\)/);
  assert.match(recovery, /for \(const record of transitions\)/);
  assert.ok(recovery.indexOf("for (const record of closes)") < recovery.indexOf("for (const record of transitions)"));
});

test("les transitions disposent d'un rejeu idempotent vers le relais", () => {
  assert.match(lifecycle, /retryTeacherSessionLifecycleOperationOnRelay/);
  assert.match(lifecycle, /record\.kind === "close"/);
  assert.match(lifecycle, /transitionTeacherAttendanceSessionOnRelay\(/);
  assert.match(lifecycle, /attemptKey: record\.attempt_key/);
  assert.match(lifecycle, /operationId: record\.operation_id/);
});
