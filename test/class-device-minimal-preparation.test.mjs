import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function classDevicePreparation(source) {
  const start = source.indexOf("async function prepareClassDevice(");
  const end = source.indexOf("type AdminBulletinClass", start);
  assert.ok(start >= 0 && end > start, "fonction prepareClassDevice introuvable");
  return source.slice(start, end);
}

test("la préparation du téléphone de classe ne charge que les briques d’appel", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const preparation = classDevicePreparation(readiness);

  assert.doesNotMatch(preparation, /prepareGrades\(/);
  assert.doesNotMatch(preparation, /prepareTextbook\(/);
  assert.doesNotMatch(preparation, /\/grades\/class-device/);
  assert.doesNotMatch(preparation, /\/enseignant\/cahier-de-texte/);
  assert.doesNotMatch(preparation, /\/choose-book/);
  assert.match(preparation, /warmOfflineShell\(\["\/class"\]\)/);
  assert.match(preparation, /rememberOfflineBookDestinations\(\{ attendance: "\/class" \}\)/);
  assert.match(preparation, /evaluation_count:\s*0/);
  assert.match(preparation, /textbook_assignment_count:\s*0/);
  assert.match(preparation, /grades_ready:\s*false/);
  assert.match(preparation, /textbook_ready:\s*false/);
});

test("la préparation utilise relais, Cloud puis dernière base locale valide", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const preparation = classDevicePreparation(readiness);

  assert.match(preparation, /fetchRelayTeacherOfflineSchedule\(/);
  assert.match(preparation, /buildClassDeviceScheduleFromCloud\(/);
  assert.match(preparation, /existingBundle!\.schedule/);
  assert.match(preparation, /preparationSource = "relay"/);
  assert.match(preparation, /preparationSource = "cloud"/);
  assert.match(preparation, /preparationSource = "local"/);
  assert.match(preparation, /persistClassDeviceBundle\(readiness, schedule\)/);
});

test("un relais indisponible devient un avertissement et non un blocage local", async () => {
  const [readiness, card, device] = await Promise.all([
    read("src/lib/offline-readiness.ts"),
    read("src/components/OfflineReadinessCard.tsx"),
    read("src/lib/offlineClassDevice.ts"),
  ]);

  assert.match(readiness, /role !== "class-device"/);
  assert.match(readiness, /class_device_compatibility:\s*compatibility/);
  assert.match(readiness, /:\s*"ready_local"/);
  assert.match(device, /status === "ready" \|\| status === "ready_local"/);
  assert.match(card, /Appels hors ligne prêts/);
  assert.match(card, /Cloud indisponible : la dernière préparation valide reste utilisable/);
  assert.doesNotMatch(classDevicePreparation(readiness), /throw new Error\(classDeviceReadinessMessage\("relay_unreachable"\)\)/);
});

test("la préparation Cloud reste possible sans imposer une politique relais valide", async () => {
  const readiness = await read("src/lib/offline-readiness.ts");
  const preparation = classDevicePreparation(readiness);

  assert.match(preparation, /resolveClassDevicePreparationIdentity\(/);
  assert.match(preparation, /relayPolicy = null/);
  assert.match(preparation, /Un relais absent ou mal configuré ne doit pas empêcher une préparation/);
});
