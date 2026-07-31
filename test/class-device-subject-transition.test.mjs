import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("après une séance débordée, le Cloud du créneau courant remplace la matière précédente", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /En ligne, le Cloud du créneau courant est la source de vérité/);
  assert.match(page, /const autoResp = await offlineGetJson\(strictUrl, strictCacheKey\)/);
  assert.match(page, /if \(autoResp != null\) \{\s*applyList\([^;]+, "auto"\);/s);
  assert.match(page, /const strictCacheKey =\s*`classDevice:subjects:\$\{classId\}:\$\{activeSubjectScopeKey\}`/);
  assert.match(page, /setSubjects\(\[\]\);\s*setSubjectScheduleIssue\(null\);\s*subjectSelectionSlotRef\.current = "";\s*setOpen\(null\);/s);
});

test("une réponse automatique ambiguë est bloquée au lieu de faire chasser la sélection", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /const automaticConflict = automaticMode && normalizedList\.length > 1/);
  assert.match(page, /const list = automaticConflict \? \[\] : normalizedList/);
  assert.match(page, /const slotChanged = automaticMode/);
  assert.match(page, /if \(slotChanged \|\| !prev \|\| !list\.some/);
  assert.match(page, /Conflit d’emploi du temps détecté pour ce créneau/);
});

test("l'API départage les anciens UUID de même horaire et le relais conserve une seule ligne", async () => {
  const [route, relay, rules] = await Promise.all([
    read("src/app/api/class/subjects/route.ts"),
    read("desktop/relay/src/teacher-offline-schedule.mts"),
    read("desktop/relay/src/teacher-session-rules.mts"),
  ]);

  assert.match(route, /Les lignes correspondantes seront ensuite départagées par fraîcheur/);
  assert.match(route, /requestedPeriodId,\s*\.\.\.exact\.map/s);
  assert.match(route, /currentTimetableSubjectIds/);
  assert.match(relay, /winnerBySlot\.get\(key\)\?\.id === row\.id/);
  assert.match(relay, /tt\.server_version DESC, tt\.updated_at DESC/);
  assert.match(rules, /ORDER BY server_version DESC, updated_at DESC, id DESC/);
  assert.match(rules, /actorKind === "teacher" && \(timetables\.length > 1/);
  assert.match(rules, /const selectedTimetable = timetables\[0\]/);
});
