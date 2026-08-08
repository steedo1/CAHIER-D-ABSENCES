import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la machine hors ligne bornée est montée pour prof, classe et admin", async () => {
  const [component, coordinator, machine, triggers, teacher, classPage, admin] = await Promise.all([
    read("src/components/OfflinePreparationCoordinator.tsx"),
    read("src/lib/offline-preparation-coordinator.ts"),
    read("src/lib/offline-preparation-machine.ts"),
    read("src/lib/offline-preparation-triggers.ts"),
    read("src/components/teacher/TeacherDashboard.tsx"),
    read("src/app/class/page.tsx"),
    read("src/app/admin/layout.tsx"),
  ]);

  assert.match(component, /createOfflinePreparationTriggerController/);
  assert.match(component, /runCoordinatedOfflinePreparation\(role, \{ trigger \}\)/);
  assert.match(component, /subscribeServiceWorker/);
  assert.match(component, /controllerchange/);
  assert.match(component, /return controller\.start\(\)/);
  assert.match(coordinator, /createOfflinePreparationMachine<OfflineReadiness>/);
  assert.doesNotMatch(coordinator, /const inFlight = new Map/);
  assert.match(coordinator, /OFFLINE_PREPARATION_MAX_AGE_MS/);
  assert.match(coordinator, /OFFLINE_PREPARATION_TIMEOUT_MS/);
  assert.match(machine, /runtime\.inFlight/);
  assert.match(machine, /state: "retry_wait"/);
  assert.match(triggers, /OFFLINE_PREPARATION_TRIGGER_DEBOUNCE_MS/);
  assert.match(triggers, /scheduleRetry/);
  assert.match(teacher, /OfflinePreparationCoordinator role="teacher"/);
  assert.match(classPage, /OfflinePreparationCoordinator[\s\S]{0,160}role="class-device"/);
  assert.match(admin, /OfflinePreparationCoordinator role="admin"/);
});

test("la préparation admin limite son cœur aux appels essentiels", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const adminPreparation = readiness.slice(
    readiness.indexOf("async function prepareAdmin"),
    readiness.indexOf("async function prepareParent"),
  );

  assert.match(
    adminPreparation,
    /fetchAdminAttendanceMonitor<AdminAttendancePreparationRow>\(\s*today,\s*today,\s*signal,\s*\)/,
  );
  assert.match(adminPreparation, /"\/admin\/absences\/appels"/);
  assert.match(adminPreparation, /"\/admin\/absences\/appels-matrice"/);
  assert.match(adminPreparation, /attendance_core_ready: true/);
  assert.match(adminPreparation, /queues_ready: true/);
  assert.match(adminPreparation, /service_worker_release: activeServiceWorkerRelease/);
  assert.doesNotMatch(adminPreparation, /getAdminBulletin/);
  assert.doesNotMatch(adminPreparation, /getCommunication/);
  assert.doesNotMatch(adminPreparation, /fetchInstitutionSettings/);
});

test("la vue admin suit strictement relais puis Cloud puis cache local", async () => {
  const localRelay = await read("src/lib/local-relay.ts");
  const monitor = localRelay.slice(
    localRelay.indexOf("export async function fetchAdminAttendanceMonitor"),
    localRelay.indexOf("export async function fetchInstitutionSettings"),
  );

  const relayIndex = monitor.indexOf("relayJson");
  const cloudIndex = monitor.indexOf("cloudJson");
  const cacheIndex = monitor.lastIndexOf("readEnvelope");
  assert.ok(relayIndex >= 0 && cloudIndex > relayIndex && cacheIndex > cloudIndex);
  assert.match(monitor, /RELAY_ADMIN_READ_TIMEOUT_MS/);
  assert.match(monitor, /institutionId/);
});

test("le téléphone classe réconcilie le relais avant tout rejeu Cloud", async () => {
  const page = await read("src/app/class/page.tsx");
  const sync = page.slice(
    page.indexOf("async function syncNow"),
    page.indexOf("syncNowRef.current = syncNow"),
  );
  const logout = page.slice(
    page.indexOf("async function logout"),
    page.indexOf("return (", page.indexOf("async function logout")),
  );

  assert.ok(
    sync.indexOf("recoverClassDeviceAttendance") <
      sync.indexOf("probeCloudAvailability"),
  );
  assert.ok(
    sync.indexOf("probeCloudAvailability") <
      sync.indexOf("result = await flushOutbox()"),
  );
  assert.match(sync, /relayHasAuthoritativePending/);
  assert.match(logout, /await syncNow\(\)/);
  assert.doesNotMatch(logout, /await flushOutbox\(\)/);
});

test("la préparation classe est Cloud-first et ne dépend pas du relais local", async () => {
  const [route, readiness, cloudProjector] = await Promise.all([
    read("src/app/api/class/my-classes/route.ts"),
    read("src/lib/offline-readiness.ts"),
    read("src/lib/class-device-offline-cloud-server.ts"),
  ]);
  const preparation = readiness.slice(
    readiness.indexOf("async function prepareClassDevice"),
    readiness.indexOf("type AdminBulletinClass"),
  );

  assert.match(route, /offline_schedule: offlineSchedule/);
  assert.match(route, /buildClassDeviceCloudSchedule/);
  assert.match(cloudProjector, /source: "cloud" as const/);
  assert.match(preparation, /classPayload\?\.offline_schedule/);
  assert.ok(
    preparation.indexOf("const relayConnectivityPromise = checkRelayWithin") <
      preparation.indexOf('warmAttendanceOfflineShell(["/login", "/class"], { signal })'),
  );
  assert.ok(
    preparation.indexOf('warmAttendanceOfflineShell(["/login", "/class"], { signal })') <
      preparation.indexOf("const relayConnectivity = await relayConnectivityPromise"),
  );
  assert.match(preparation, /relayUsable \? "ready" : "ready_local"/);
  assert.match(preparation, /persistClassDeviceBundle\(readiness, authoritativeSchedule\)/);
  assert.doesNotMatch(
    preparation,
    /if \(relayConnectivity\.status !== "reachable"\)[\s\S]{0,300}throw new Error/,
  );
});

test("les statuts en attente et la PWA installable sont câblés de bout en bout", async () => {
  const [cloud, relay, matrix, details, manifest, layout, worker] = await Promise.all([
    read("src/app/api/admin/attendance/monitor/route.ts"),
    read("desktop/relay/src/attendance-monitor.mts"),
    read("src/app/admin/absences/appels-matrice/page.tsx"),
    read("src/app/admin/absences/appels/page.tsx"),
    read("src/app/manifest.ts"),
    read("src/app/layout.tsx"),
    read("public/moncahier-sw.js"),
  ]);

  for (const source of [cloud, relay, matrix, details]) {
    assert.match(source, /"waiting"|"pending_absence"/);
  }
  assert.match(matrix, /activeSlot/);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /start_url: "\/login"/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(worker, /webmanifest/);
});
