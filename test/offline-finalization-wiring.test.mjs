import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la préparation hors ligne silencieuse est montée pour prof, classe et admin", async () => {
  const [component, coordinator, teacher, classPage, admin] = await Promise.all([
    read("src/components/OfflinePreparationCoordinator.tsx"),
    read("src/lib/offline-preparation-coordinator.ts"),
    read("src/components/teacher/TeacherDashboard.tsx"),
    read("src/app/class/page.tsx"),
    read("src/app/admin/layout.tsx"),
  ]);

  assert.match(component, /setTimeout\(refresh, 1_000\)/);
  assert.match(component, /setInterval/);
  assert.match(component, /addEventListener\("online", refresh\)/);
  assert.match(component, /addEventListener\("focus", refresh\)/);
  assert.match(component, /visibilitychange/);
  assert.match(coordinator, /const inFlight = new Map/);
  assert.match(coordinator, /OFFLINE_PREPARATION_MAX_AGE_MS/);
  assert.match(teacher, /OfflinePreparationCoordinator role="teacher"/);
  assert.match(classPage, /OfflinePreparationCoordinator role="class-device"/);
  assert.match(admin, /OfflinePreparationCoordinator role="admin"/);
});

test("la préparation admin rend les appels essentiels et les documents complémentaires", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const adminPreparation = readiness.slice(
    readiness.indexOf("async function prepareAdmin"),
    readiness.indexOf("async function prepareParent"),
  );

  assert.match(
    adminPreparation,
    /fetchAdminAttendanceMonitor<AdminAttendancePreparationRow>\(today, today\)/,
  );
  assert.match(adminPreparation, /fetchInstitutionSettings/);
  assert.match(adminPreparation, /"\/admin\/absences\/appels"/);
  assert.match(adminPreparation, /"\/admin\/absences\/appels-matrice"/);
  assert.ok(
    adminPreparation.indexOf("fetchAdminAttendanceMonitor") <
      adminPreparation.indexOf("getAdminBulletinClasses"),
  );
  assert.match(adminPreparation, /complémentaire/);
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
    assert.match(source, /"waiting"/);
  }
  assert.match(matrix, /selectedSlotKey/);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /start_url: "\/login"/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(worker, /webmanifest/);
});
