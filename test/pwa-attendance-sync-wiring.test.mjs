import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("les routes enseignant exigent et renvoient l'ACK exact", async () => {
  const [start, end, attendance] = await Promise.all([
    read("src/app/api/teacher/sessions/start/route.ts"),
    read("src/app/api/teacher/sessions/end/route.ts"),
    read("src/app/api/teacher/attendance/bulk/route.ts"),
  ]);

  for (const source of [start, end, attendance]) {
    assert.match(source, /x-mon-cahier-operation-id/);
    assert.match(source, /operation_id_required/);
    assert.match(source, /invalid_operation_id/);
    assert.match(source, /operation_id:\s*operationId/);
  }
});

test("la PWA pure journalise ouverture, marques et clôture avec leurs dépendances", async () => {
  const dashboard = await read("src/components/teacher/TeacherDashboard.tsx");
  assert.match(
    dashboard,
    /startDecision\.mode === "device_only"[\s\S]*?queueOnly: true[\s\S]*?operationId: local\.operation_id/,
  );
  assert.match(
    dashboard,
    /operationId: attendance\.operation_id[\s\S]*?operationType: "attendance"/,
  );
  assert.match(
    dashboard,
    /operationType: "session-end"[\s\S]*?clientSessionId: clientId \|\| open\.id/,
  );
  assert.match(dashboard, /\{pending\} à synchroniser/);
  assert.match(dashboard, /syncStatus\.blocked/);
  assert.match(dashboard, /syncStatus\.conflicts/);
});

test("le synchroniseur Cloud impose ouverture → appel → clôture", async () => {
  const [sync, offline, background] = await Promise.all([
    read("src/lib/teacher-attendance-cloud-sync.ts"),
    read("src/lib/offline.ts"),
    read("src/components/BackgroundAttendanceDeliverySync.tsx"),
  ]);
  const startPhase = sync.indexOf('includeOperationTypes: ["session-start"]');
  const attendancePhase = sync.indexOf('includeOperationTypes: ["attendance"]');
  const closePhase = sync.indexOf('excludeOperationTypes: ["session-start", "attendance"]');
  assert.ok(startPhase > 0);
  assert.ok(attendancePhase > startPhase);
  assert.ok(closePhase > attendancePhase);
  assert.match(sync, /deferSessionEndKeys: deferredSessionEnds/);
  assert.match(sync, /releaseNetworkBackoff: true/g);
  assert.match(offline, /sessionsWaitingForStart/);
  assert.match(offline, /acknowledgedOperationId !== row\.operationId/);
  assert.match(background, /syncTeacherAttendanceOperationsToCloud/);
});

test("le périmètre notes reste cloud-only", async () => {
  const [offline, capabilities] = await Promise.all([
    read("src/lib/offline.ts"),
    read("src/lib/grade-write-capabilities.ts"),
  ]);
  assert.match(offline, /OFFLINE_GRADE_WRITES_DISABLED_ERROR/);
  assert.match(
    capabilities,
    /OFFLINE_GRADE_WRITES_ENABLED\s*=\s*\n\s*process\.env\.NEXT_PUBLIC_MONCAHIER_OFFLINE_GRADE_WRITES_ENABLED === "true"/,
  );
});


test("les établissements sans relais disposent d'un vrai Background Sync des appels", async () => {
  const [offline, worker, background] = await Promise.all([
    read("src/lib/offline.ts"),
    read("public/moncahier-sw.js"),
    read("src/components/BackgroundAttendanceDeliverySync.tsx"),
  ]);

  assert.match(offline, /ATTENDANCE_BACKGROUND_SYNC_TAG = "moncahier-attendance-outbox-v1"/);
  assert.match(offline, /requestAttendanceBackgroundSync/);
  assert.match(offline, /syncManager\.register\(ATTENDANCE_BACKGROUND_SYNC_TAG\)/);
  assert.match(
    offline,
    /queuedOperationType === "session-start"[\s\S]*queuedOperationType === "attendance"[\s\S]*queuedOperationType === "session-end"[\s\S]*requestAttendanceBackgroundSync/,
  );

  assert.match(worker, /self\.addEventListener\("sync"/);
  assert.match(worker, /event\.tag !== ATTENDANCE_BACKGROUND_SYNC_TAG/);
  assert.match(worker, /replayAttendanceOutboxFromWorker/);
  assert.match(worker, /ATTENDANCE_CALL_OPERATION_TYPES/);
  assert.match(worker, /sessionsWaitingForStart/);
  assert.match(worker, /blockedSessions/);
  assert.match(
    worker,
    /row\?\.state === "blocked"[\s\S]*operationType === "session-start"[\s\S]*operationType === "attendance"[\s\S]*blockedSessions\.add/,
  );
  assert.match(worker, /X-Mon-Cahier-Operation-Id/);
  assert.match(worker, /attendanceResponseOperationId/);
  assert.match(worker, /writeAttendanceSessionMap/);
  assert.match(worker, /credentials: "include"/);
  assert.match(worker, /ATTENDANCE_REPLAY_TIMEOUT_MS = 8_000/);
  assert.match(worker, /fetchWithTimeout\([\s\S]*ATTENDANCE_REPLAY_TIMEOUT_MS/);

  assert.doesNotMatch(
    background,
    /document\.visibilityState === "hidden"\) return/,
  );
});


test("une restriction Cloud 402 conserve le secours PWA et la file des appels", async () => {
  const [login, offline, worker] = await Promise.all([
    read("src/components/auth/LoginCard.tsx"),
    read("src/lib/offline.ts"),
    read("public/moncahier-sw.js"),
  ]);

  assert.match(login, /res\.status === 402 \|\| res\.status >= 500/);
  assert.match(
    offline,
    /return status === 402 \|\| status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500/,
  );
  assert.match(
    worker,
    /return status === 402 \|\| status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500/,
  );
  assert.match(
    worker,
    /networkResponse\.status !== 402 && networkResponse\.status < 500/,
  );
});
