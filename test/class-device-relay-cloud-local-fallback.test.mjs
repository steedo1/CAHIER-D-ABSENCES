import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("le démarrage sécurise l'appareil puis tente le relais et le Cloud avec le même operation_id", async () => {
  const page = await read("src/app/class/page.tsx");

  const localStageIndex = page.indexOf("stageTeacherAttendanceSessionOpen({");
  const localCacheIndex = page.indexOf(
    'cacheSet("classDevice:local-open", pendingOpen)',
    localStageIndex,
  );
  const relayIndex = page.indexOf("openTeacherAttendanceSessionOnRelay({");
  const cloudIndex = page.indexOf('"/api/class/sessions/start"', relayIndex);

  assert.ok(localStageIndex >= 0, "journal local absent");
  assert.ok(localCacheIndex > localStageIndex, "cache local non confirmé");
  assert.ok(relayIndex > localCacheIndex, "le relais doit venir après le stockage local");
  assert.ok(relayIndex >= 0, "tentative relais absente");
  assert.ok(cloudIndex > relayIndex, "le Cloud doit venir après le relais");
  assert.match(page, /const operationId = stagedOpen\.operation_id/);
  assert.match(page, /operationId,\s+mergeKey: `session-start:\$\{attemptKey\}`/s);
  assert.match(page, /const clientSessionId = `client:\$\{operationId\}`/);
  assert.match(page, /meta: \{\s+operationType: "session-start",\s+clientSessionId/s);
  assert.doesNotMatch(
    page,
    /if \(relayDelivery\.state === "blocked"\)[\s\S]{0,160}return;/,
  );
});

test("la séance locale pending survit au rechargement", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /function isRestorableClassDeviceOpen/);
  assert.match(page, /value\.delivery_origin === "local_pending"/);
  assert.match(page, /isClientSessionId\(value\.id\)/);
  assert.match(page, /isRestorableClassDeviceOpen\(localOpenCandidate\)/);
  assert.match(page, /isRestorableClassDeviceOpen\(snapState\.open\)/);
  assert.match(page, /cacheSet\("classDevice:local-open", pendingOpen\)/);
  assert.match(page, /chooseRestorableClassDeviceOpen\(\{/);
  assert.match(page, /persistAttendanceRowsImmediately/);
  assert.match(page, /saveClassDeviceSnapshot<ClassPageSnapshotState>/);
});


test("le mapping client vers serveur et la restauration Cloud du téléphone de classe sont explicites", async () => {
  const [page, openRoute, offline] = await Promise.all([
    read("src/app/class/page.tsx"),
    read("src/app/api/teacher/sessions/open/route.ts"),
    read("src/lib/offline.ts"),
  ]);

  assert.match(page, /resolveOfflineSessionReference\(cur\.id\)/);
  assert.match(page, /resolved\.serverSessionId/);
  assert.match(page, /delivery_origin: "cloud_fallback"/);
  assert.match(openRoute, /\.eq\("created_by", user\.id\)/);
  assert.match(openRoute, /\.eq\("origin", "class_device"\)/);
  assert.match(openRoute, /delivery_origin: classDeviceOrigin \? "cloud_fallback"/);
  assert.match(offline, /registerOfflineSessionReference\(clientKey, String\(serverId\)\)/);
});

test("le Cloud conserve l'heure capturée hors ligne et vérifie le period_id exact", async () => {
  const route = await read("src/app/api/class/sessions/start/route.ts");

  assert.match(route, /const maxOfflineAgeMs = 30 \* 24 \* 60 \* 60_000/);
  assert.match(route, /const clientObservedAtAccepted = Boolean/);
  assert.match(route, /const actualCallAt = clientObservedAtAccepted\s+\? clientObservedAt!\s+: serverNow/s);
  assert.match(route, /const requestedPeriodMismatch\s*=\s*Boolean/);
  assert.match(route, /requestedPeriodId !== currentPeriod\.periodId/);
  assert.doesNotMatch(route, /error: "period_id_mismatch"/);
  assert.match(route, /period_id: currentPeriod\.periodId/);
  assert.match(route, /delivery_origin: "cloud_fallback"/);
  assert.match(route, /server_time: serverNow\.toISOString\(\)/);
  assert.match(route, /"device_time_preserved_for_offline_sync"/);
  assert.match(route, /"cloud_time_applied_invalid_device_time"/);
});

test("le téléphone de classe ne demande jamais le GPS et le téléphone personnel garde ses contrôles", async () => {
  const [page, classStart, classAttendance, teacherStart] = await Promise.all([
    read("src/app/class/page.tsx"),
    read("src/app/api/class/sessions/start/route.ts"),
    read("src/app/api/teacher/attendance/bulk/route.ts"),
    read("src/app/api/teacher/sessions/start/route.ts"),
  ]);

  assert.doesNotMatch(page, /geolocation|getCurrentPosition|watchPosition/);
  assert.doesNotMatch(classStart, /verifyAttendancePresence|geolocation|getCurrentPosition|watchPosition/i);
  assert.match(classAttendance, /classDeviceAuthorized/);
  assert.match(classAttendance, /!classDeviceAuthorized &&\s+session\.presence_verified !== true/);
  assert.match(teacherStart, /verifyAttendancePresence/);
});

test("les requêtes critiques ont des timeouts courts, un verrou et un backoff", async () => {
  const offline = await read("src/lib/offline.ts");

  assert.match(offline, /DEFAULT_MUTATION_TIMEOUT_MS = 6_000/);
  assert.match(offline, /OUTBOX_REPLAY_TIMEOUT_MS = 8_000/);
  assert.match(offline, /fetchWithTimeout/);
  assert.match(offline, /outboxRetryDelayMs/);
  assert.match(offline, /navigator[\s\S]*locks/);
  assert.match(offline, /moncahier-offline-outbox/);
});

test("l'interface distingue Cloud, relais et synchronisation de l'appel", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /Cloud : \{connectivityLabel\(cloudStatus\)\}/);
  assert.match(page, /Relais local : \{connectivityLabel\(relayStatus\)\}/);
  assert.match(page, /Appel : \{callSyncLabel\}/);
  assert.match(page, /Relais local indisponible\. L'appel continue via le Cloud\./);
  assert.match(
    page,
    /Relais et Internet indisponibles\. L'appel est sécurisé sur ce téléphone et sera synchronisé automatiquement\./,
  );
});

test("ouverture et fermeture Cloud exposent leur operation_id et sont rejouables", async () => {
  const [startRoute, endRoute, offline] = await Promise.all([
    read("src/app/api/class/sessions/start/route.ts"),
    read("src/app/api/class/sessions/end/route.ts"),
    read("src/lib/offline.ts"),
  ]);

  assert.match(startRoute, /x-mon-cahier-operation-id/);
  assert.match(startRoute, /idempotent = Boolean\(session\)/);
  assert.match(startRoute, /operation_id: operationId \|\| null/);
  assert.match(endRoute, /x-mon-cahier-operation-id/);
  assert.match(endRoute, /idempotent: true/);
  assert.match(offline, /X-Mon-Cahier-Operation-Id/);
  assert.match(offline, /rewriteBodyWithSessionMap/);
  assert.match(offline, /maybeUpdateSessionMapFromStart/);
});

test("chaque fermeture locale est une opération ordonnée et ne peut pas être écrasée par le cours suivant", async () => {
  const [page, offline] = await Promise.all([
    read("src/app/class/page.tsx"),
    read("src/lib/offline.ts"),
  ]);

  assert.match(offline, /queueOnly\?: boolean/);
  assert.match(offline, /if \(opts\?\.queueOnly\)[\s\S]*queued_by_client/);
  assert.match(page, /operationType: "attendance"[\s\S]*operationType: "session-end"/);
  assert.match(page, /mergeKey: `end:\$\{openId\}`/);
  assert.doesNotMatch(page, /cacheSet\(PENDING_END_KEY,\s*\{\s*actual_end_at:/);
  assert.match(page, /aucun marqueur unique ne peut être écrasé/);
});

test("le retour Cloud respecte ouverture, appel puis fermeture sans dépasser une opération bloquée", async () => {
  const [page, offline, attendanceRoute, endRoute] = await Promise.all([
    read("src/app/class/page.tsx"),
    read("src/lib/offline.ts"),
    read("src/app/api/teacher/attendance/bulk/route.ts"),
    read("src/app/api/class/sessions/end/route.ts"),
  ]);

  assert.match(page, /queueCloudFallbackForRelaySession/);
  assert.match(page, /operationId: openOperationId[\s\S]*operationId: input\.attendanceOperationId[\s\S]*operationId: input\.closeOperationId/);
  assert.match(page, /markTeacherAttendanceSyncedInCloud/);
  assert.match(page, /markTeacherSessionClosedInCloud/);
  assert.match(offline, /const blockedSessions = new Set<string>\(\)/);
  assert.match(offline, /blockedSessions\.has\(dependencyKey\)/);
  assert.match(offline, /operationType === "session-end"/);
  assert.match(attendanceRoute, /atomicStatus === "session_closed"/);
  assert.match(attendanceRoute, /atomicStatus !== "applied" && atomicStatus !== "already_applied"/);
  assert.match(attendanceRoute, /operation_id: operationId/);
  assert.match(endRoute, /error: "session_id_required"/);
  assert.doesNotMatch(endRoute, /order\("started_at", \{ ascending: false \}\)/);
});

test("une réponse Cloud perdue est rejouée avec le même identifiant au lieu de réécrire l'histoire", async () => {
  const [attendanceDelivery, lifecycle, page] = await Promise.all([
    read("src/lib/teacher-attendance-delivery.ts"),
    read("src/lib/teacher-session-lifecycle-delivery.ts"),
    read("src/app/class/page.tsx"),
  ]);

  assert.doesNotMatch(attendanceDelivery, /state === "delivery_unknown" \|\|/);
  assert.match(attendanceDelivery, /cloud_operation_id_mismatch/);
  assert.match(lifecycle, /state === "cloud_confirmed"/);
  assert.match(page, /relay_state: "cloud_confirmed"/);
  assert.match(page, /sans modifier leurs heures originales/);
});
