import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("le téléphone de classe utilise le Cloud strict et un cache scoppé par révision", async () => {
  const [page, readiness, route] = await Promise.all([
    read("src/app/class/page.tsx"),
    read("src/lib/offline-readiness.ts"),
    read("src/app/api/class/subjects/route.ts"),
  ]);

  assert.match(page, /fetch\(strictUrl,[\s\S]*cache:\s*"no-store"/);
  assert.match(page, /classDeviceSubjectSlotCacheKey\(/);
  assert.match(page, /setCloudScheduleRevision\(responseRevision\)/);
  assert.match(page, /currentPreparedRevision !== responseRevision/);
  assert.match(page, /relayClassScheduleRef\.current = null/);
  assert.match(page, /prepareOffline\("class-device"\)/);
  assert.match(readiness, /"classDevice:subjects:v2"/);
  assert.match(readiness, /scheduleRevision:\s*schedule\.schedule_revision/);
  assert.match(route, /attendance_schedule_revisions/);
  assert.match(route, /schedule_revision:\s*scheduleRevision/);
});

test("un cache legacy de classe ne remplace jamais le cours du créneau courant", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(
    page,
    /Never substitute the class-wide legacy subject list for a\s*missing scheduled slot/,
  );
  assert.match(
    page,
    /Le planning vérifié de ce créneau n’est pas disponible hors connexion/,
  );
  assert.match(
    page,
    /A class-wide legacy list must never masquerade as the current\s*scheduled slot/,
  );
});

test("les matières simultanées légitimes sont conservées et choisies explicitement", async () => {
  const [page, route, relay] = await Promise.all([
    read("src/app/class/page.tsx"),
    read("src/app/api/class/subjects/route.ts"),
    read("desktop/relay/src/teacher-offline-schedule.mts"),
  ]);

  assert.match(page, /Plusieurs cours sont prévus sur ce créneau/);
  assert.doesNotMatch(page, /automaticConflict = automaticMode/);
  assert.match(route, /return Array\.from\(\s*new Set/s);
  assert.match(relay, /winnerByAssignment/);
  assert.match(relay, /row\.subject_id/);
  assert.match(relay, /row\.teacher_id/);
});

test("la discipline choisie est transportée jusqu'au relais et vérifiée", async () => {
  const [page, delivery, protocol, relayOpen, rules] = await Promise.all([
    read("src/app/class/page.tsx"),
    read("src/lib/teacher-session-delivery.ts"),
    read("src/lib/teacher-session-protocol.ts"),
    read("desktop/relay/src/teacher-session-open.mts"),
    read("desktop/relay/src/teacher-session-rules.mts"),
  ]);

  assert.match(page, /stageTeacherAttendanceSessionOpen\([\s\S]*subjectId/);
  assert.match(page, /openTeacherAttendanceSessionOnRelay\([\s\S]*subjectId/);
  assert.match(delivery, /subjectId\?: string \| null/);
  assert.match(delivery, /subject_id:\s*input\.subjectId \|\| null/);
  assert.match(protocol, /subject_id\?: string/);
  assert.match(relayOpen, /"subject_id"/);
  assert.match(relayOpen, /subjectId:\s*operation\.subject_id \|\| null/);
  assert.match(rules, /subjectFilter = requestedSubjectId \? "AND subject_id = \?" : ""/);
  assert.match(rules, /"class_timetable_ambiguous"/);
});
