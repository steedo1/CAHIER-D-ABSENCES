import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `Section absente: ${start}`);
  assert.ok(to > from, `Fin de section absente: ${end}`);
  return source.slice(from, to);
}

const forbiddenAttendanceDependencies = [
  /\/api\/grades\//,
  /\/api\/teacher\/grades\//,
  /\/api\/teacher\/textbook\//,
  /\/api\/admin\/bulletins\//,
  /\/api\/admin\/communication\//,
  /prepareGrades/,
  /prepareTextbook/,
  /getAdminBulletin/,
  /getCommunicationMeta/,
];

test("le cœur professeur ne dépend que des données indispensables à l'appel", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const teacher = section(readiness, "async function prepareTeacher", "async function prepareClassDevice");

  assert.match(teacher, /\/api\/teacher\/offline\/bootstrap/);
  assert.match(teacher, /\/api\/auth\/role/);
  assert.match(teacher, /\/api\/teacher\/institution\/basics/);
  assert.match(teacher, /\/api\/teacher\/roster\?class_id=/);
  assert.match(teacher, /\/api\/teacher\/sessions\/open/);
  assert.match(teacher, /warmAttendanceOfflineShell\(\["\/login", "\/attendance"\]/);
  assert.match(teacher, /attendance_core_ready: true/);
  assert.match(teacher, /queues_ready: true/);
  assert.match(teacher, /preparation_scope: "attendance-core"/);
  assert.match(teacher, /evaluation_count: 0/);
  assert.match(teacher, /textbook_assignment_count: 0/);

  for (const dependency of forbiddenAttendanceDependencies) {
    assert.doesNotMatch(teacher, dependency);
  }
});

test("Notes, évaluations, progressions et cahier de texte ne peuvent plus bloquer l'appel", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const attendanceCore = section(readiness, "async function prepareTeacher", "type ParentChild");

  for (const dependency of forbiddenAttendanceDependencies) {
    assert.doesNotMatch(attendanceCore, dependency);
  }
  assert.doesNotMatch(attendanceCore, /grading-periods/);
  assert.doesNotMatch(attendanceCore, /evaluations\?/);
  assert.doesNotMatch(attendanceCore, /textbook\/bootstrap/);
  assert.doesNotMatch(attendanceCore, /progression/i);
});

test("le téléphone classe reste strictement borné à sa classe et sans GPS", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const classPreparation = section(readiness, "async function prepareClassDevice", "type AdminAttendancePreparationRow");

  assert.match(classPreparation, /\/api\/class\/my-classes\?offline_contract=v5/);
  assert.match(classPreparation, /warmAttendanceOfflineShell\(\["\/login", "\/class"\]/);
  assert.match(classPreparation, /validateClassDeviceScheduleScope/);
  assert.match(classPreparation, /persistClassDeviceBundle/);
  assert.doesNotMatch(classPreparation, /geolocation|getCurrentPosition|GPS/i);
  assert.doesNotMatch(classPreparation, /\/api\/grades\//);
  assert.doesNotMatch(classPreparation, /\/api\/teacher\/textbook\//);
});

test("Admin ne prépare que la supervision des appels", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const admin = section(readiness, "async function prepareAdmin", "type ParentChild");

  assert.match(admin, /fetchAdminAttendanceMonitor/);
  assert.match(admin, /\/admin\/absences\/appels/);
  assert.match(admin, /\/admin\/absences\/appels-matrice/);
  assert.doesNotMatch(admin, /\/api\/admin\/bulletins\//);
  assert.doesNotMatch(admin, /\/api\/admin\/communication\//);
  assert.doesNotMatch(admin, /getAdminBulletin|getCommunicationMeta|conduct/i);
});

test("le coordinateur est l'unique moteur et la carte reste un observateur", async () => {
  const [card, coordinatorComponent, coordinator, machine, triggers] = await Promise.all([
    read("src/components/OfflineReadinessCard.tsx"),
    read("src/components/OfflinePreparationCoordinator.tsx"),
    read("src/lib/offline-preparation-coordinator.ts"),
    read("src/lib/offline-preparation-machine.ts"),
    read("src/lib/offline-preparation-triggers.ts"),
  ]);

  assert.doesNotMatch(card, /addEventListener\("online"|addEventListener\("focus"|visibilitychange/);
  assert.doesNotMatch(card, /prepareOffline/);
  assert.match(card, /subscribeOfflinePreparation/);
  assert.match(coordinatorComponent, /createOfflinePreparationTriggerController/);
  assert.match(coordinatorComponent, /return controller\.start\(\)/);
  assert.match(coordinator, /minimumCheckIntervalMs: 15_000/);
  assert.match(coordinator, /retryDelaysMs: \[15_000, 45_000, 120_000, 300_000\]/);
  assert.match(machine, /runtime\.inFlight/);
  assert.match(machine, /finally/);
  assert.match(machine, /state: "retry_wait"/);
  assert.match(triggers, /OFFLINE_PREPARATION_TRIGGER_DEBOUNCE_MS/);
});

test("les opérations réseau et service worker critiques possèdent des délais et une annulation", async () => {
  const [helper, worker, coordinator, cloud] = await Promise.all([
    read("src/lib/offline-preparation-service-worker.ts"),
    read("public/moncahier-sw.js"),
    read("src/lib/offline-preparation-coordinator.ts"),
    read("src/lib/cloud-availability.ts"),
  ]);

  assert.match(helper, /OFFLINE_PREPARATION_WORKER_TIMEOUT_MS/);
  assert.match(helper, /OFFLINE_PREPARATION_SHELL_TIMEOUT_MS/);
  assert.match(helper, /MON_CAHIER_CANCEL_WARM_SHELL/);
  assert.match(worker, /WARM_FETCH_TIMEOUT_MS/);
  assert.match(worker, /AbortController/);
  assert.match(worker, /MON_CAHIER_CANCEL_WARM_SHELL/);
  assert.match(coordinator, /relayCheckWithin/);
  assert.match(coordinator, /timeoutMs = 4_000/);
  assert.match(cloud, /CLOUD_PROBE_TIMEOUT_MS/);
});
