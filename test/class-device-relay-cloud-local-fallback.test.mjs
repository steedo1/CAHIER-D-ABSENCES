import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("le démarrage suit relais puis Cloud puis appareil avec un même operation_id", async () => {
  const page = await read("src/app/class/page.tsx");

  const relayIndex = page.indexOf("openTeacherAttendanceSessionOnRelay({");
  const cloudIndex = page.indexOf('"/api/class/sessions/start"', relayIndex);
  const localIndex = page.indexOf('delivery_origin: "local_pending"', cloudIndex);

  assert.ok(relayIndex >= 0, "tentative relais absente");
  assert.ok(cloudIndex > relayIndex, "le Cloud doit venir après le relais");
  assert.ok(localIndex > cloudIndex, "le stockage local doit venir après le Cloud");
  assert.match(page, /const operationId = relayDelivery\.operation_id/);
  assert.match(page, /operationId,\s+mergeKey: `session-start:\$\{attemptKey\}`/s);
  assert.match(page, /const clientSessionId = `client:\$\{operationId\}`/);
  assert.match(page, /meta: \{\s+operationType: "session-start",\s+clientSessionId/s);
  assert.match(page, /if \(relayDelivery\.state === "blocked"\)/);
});

test("la séance locale pending survit au rechargement", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /function isRestorableClassDeviceOpen/);
  assert.match(page, /value\.delivery_origin === "local_pending"/);
  assert.match(page, /isClientSessionId\(value\.id\)/);
  assert.match(page, /isRestorableClassDeviceOpen\(localOpenCandidate\)/);
  assert.match(page, /isRestorableClassDeviceOpen\(snapState\.open\)/);
  assert.match(page, /cacheSet\("classDevice:local-open", pendingOpen\)/);
  assert.match(page, /localOpen \|\| serverOpen \|\| null/);
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
  assert.match(offline, /map\[clientKey\] = serverId/);
});

test("le Cloud fallback utilise son heure serveur et vérifie le period_id exact", async () => {
  const route = await read("src/app/api/class/sessions/start/route.ts");

  assert.match(route, /const serverNow = new Date\(\);\s+const actualCallAt = serverNow;/s);
  assert.match(route, /const requestedPeriodMismatch\s*=\s*Boolean/);
  assert.match(route, /requestedPeriodId !== currentPeriod\.periodId/);
  assert.doesNotMatch(route, /error: "period_id_mismatch"/);
  assert.match(route, /period_id: currentPeriod\.periodId/);
  assert.match(route, /delivery_origin: "cloud_fallback"/);
  assert.match(route, /server_time: serverNow\.toISOString\(\)/);
  assert.match(route, /action: "cloud_time_applied_without_gps_or_blocking"/);
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
  assert.match(page, /Relais local indisponible\. L’appel continue via le Cloud\./);
  assert.match(
    page,
    /Relais et Internet indisponibles\. L’appel est enregistré sur ce téléphone et sera synchronisé automatiquement\./,
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
