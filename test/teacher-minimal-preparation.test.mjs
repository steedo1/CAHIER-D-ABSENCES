import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function teacherPreparation(source) {
  const start = source.indexOf("async function prepareTeacher(");
  const end = source.indexOf("async function prepareClassDevice(", start);
  assert.ok(start >= 0 && end > start, "fonction prepareTeacher introuvable");
  return source.slice(start, end);
}

test("la préparation professeur ne télécharge que le paquet nécessaire à l'appel", async () => {
  const [source, card] = await Promise.all([
    read("src/lib/offline-readiness.ts"),
    read("src/components/OfflineReadinessCard.tsx"),
  ]);
  const preparation = teacherPreparation(source);

  assert.doesNotMatch(preparation, /prepareGrades\(/);
  assert.doesNotMatch(preparation, /prepareTextbook\(/);
  assert.doesNotMatch(preparation, /conduct\/settings/);
  assert.doesNotMatch(preparation, /\/grades/);
  assert.doesNotMatch(preparation, /cahier-de-texte/);
  assert.match(preparation, /warmOfflineShell\(\["\/attendance", "\/login"\]\)/);
  assert.match(preparation, /evaluation_count:\s*0/);
  assert.match(preparation, /textbook_assignment_count:\s*0/);
  assert.match(preparation, /grades_ready:\s*false/);
  assert.match(preparation, /textbook_ready:\s*false/);
  assert.match(card, /listes d’élèves nécessaires à l’appel/);
  assert.doesNotMatch(card, /l’emploi du temps, les listes d’élèves, les évaluations/);
});

test("le paquet professeur et son marqueur prêt sont publiés atomiquement", async () => {
  const [readiness, offline] = await Promise.all([
    read("src/lib/offline-readiness.ts"),
    read("src/lib/offline.ts"),
  ]);
  const preparation = teacherPreparation(readiness);

  assert.match(preparation, /cacheSetMany\(entries\)/);
  assert.doesNotMatch(preparation, /await cacheSet\(/);
  assert.match(preparation, /\[readinessKey\("teacher"\), readiness\]/);
  assert.match(offline, /export async function cacheSetMany/);
  assert.match(offline, /db\.transaction\(\["kv"\], "readwrite"\)/);
});

test("la préparation est single-flight par rôle et accepte le relais sans Cloud", async () => {
  const source = await read("src/lib/offline-readiness.ts");

  assert.match(source, /const preparationInFlight = new Map<OfflineRole, PreparationTask>/);
  assert.match(source, /const running = preparationInFlight\.get\(role\)/);
  assert.match(source, /Cloud indisponible : récupération du paquet d’appel depuis le relais/);
  assert.match(source, /fetchRelayTeacherOfflineSchedule\(/);
});
