import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("terminer hors ligne libère immédiatement l'écran et le cache de séance", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /stageTeacherAttendanceSessionClose/);
  assert.match(page, /cacheSet\("classDevice:local-open", null\)/);
  assert.match(
    page,
    /cacheSet\("classDevice:open-session", \{ item: null \}\)/,
  );
  assert.match(page, /setOpen\(null\)/);
  assert.match(page, /setRoster\(\[\]\)/);
  assert.match(page, /setRows\(\{\}\)/);
  assert.match(page, /saveClassDeviceSnapshot<ClassPageSnapshotState>/);
  assert.match(page, /open: null,\s+rows: \{\}/);
  assert.match(page, /Séance précédente terminée/);
});

test("le prochain créneau est recalculé depuis le bundle v5 sans Internet", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /getClassDeviceCoherentSchedule/);
  assert.match(page, /periodsFromRelayClassSchedule/);
  assert.match(page, /computeDefaultsForNow\(sourcePeriods, currentMs\)/);
  assert.match(page, /relaySubjectsForSlot/);
  assert.doesNotMatch(page, /Aucune discipline en cache \(préparez/);
  assert.match(page, /Aucun cours vérifié pour ce créneau/);
});

test("la reprise LAN fonctionne même lorsque navigator.onLine vaut false", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /recoverClassDeviceAttendance/);
  assert.match(page, /window\.setInterval\(retry, 20_000\)/);
  assert.match(page, /document\.addEventListener\("visibilitychange", retry\)/);
  assert.match(page, /disabled=\{syncing \|\| pendingSync === 0\}/);
  assert.doesNotMatch(
    page,
    /disabled=\{syncing \|\| !isOnline \|\| pendingSync === 0\}/,
  );
});

test("un redémarrage ne restaure pas une séance déjà terminée localement", async () => {
  const page = await read("src/app/class/page.tsx");
  const lifecycle = await read(
    "src/lib/teacher-session-lifecycle-delivery.ts",
  );

  assert.match(page, /isTeacherSessionLocallyFinalized/);
  assert.match(page, /completion\.session_id === localOpen\.id/);
  assert.match(page, /snapshotAlreadyFinished/);
  assert.match(
    lifecycle,
    /record\.kind === "close" &&\s+record\.session_id === normalizedSessionId/,
  );
});

test("la déconnexion compte aussi les appels et fermetures du nouveau protocole", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /countPendingForCurrentClass/);
  assert.match(page, /countClassDeviceAttendanceRecovery/);
  assert.match(page, /Tentative de sécurisation des données avant déconnexion/);
  assert.match(page, /supprimer définitivement ces données/);
});

test("le Web et le service worker portent la même release lifecycle v5.2", async () => {
  const [worker, release] = await Promise.all([
    read("public/moncahier-sw.js"),
    read("src/lib/offline-release.ts"),
  ]);

  const expected = "2026-07-30-class-device-lifecycle-v5-2";
  assert.match(worker, new RegExp(expected));
  assert.match(release, new RegExp(expected));
});
