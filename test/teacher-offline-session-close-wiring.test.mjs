import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `section start not found: ${start}`);
  assert.notEqual(endIndex, -1, `section end not found: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("la coupure du relais après l'appel met en file les marques puis la fermeture et libère le professeur", async () => {
  const dashboard = await read("src/components/teacher/TeacherDashboard.tsx");
  const endSession = section(
    dashboard,
    "async function endSession()",
    "async function beginNextSessionTransition()",
  );
  const relaySession = section(
    endSession,
    "if (open.local_relay)",
    "const finalMarks = attendanceMarksFromRows(rows)",
  );

  assert.match(dashboard, /stageTeacherAttendanceSessionClose/);
  assert.match(relaySession, /let attendanceOperationId: string \| null = null/);
  assert.match(relaySession, /attendanceOperationId = attendance\.operation_id/);
  assert.match(
    relaySession,
    /if \(attendance\.state === "device_pending"\)[\s\S]*stageTeacherAttendanceSessionClose\([\s\S]*attendanceOperationId,[\s\S]*await finishLocal\(\)/,
  );
  assert.match(
    relaySession,
    /closeTeacherAttendanceSessionOnRelay\([\s\S]*classId: open\.class_id,[\s\S]*attendanceOperationId,/,
  );
  assert.match(
    relaySession,
    /if \(closed\.state === "device_pending"\)[\s\S]*await finishLocal\(\)/,
  );
  assert.match(relaySession, /le cours suivant peut commencer/);
  assert.match(relaySession, /closed\.state !== "relay_confirmed"/);
  assert.match(relaySession, /La liste reste affichée jusqu’à confirmation/);
});

test("une séance terminée localement n'est restaurée ni au rechargement ni après une synchro Cloud", async () => {
  const dashboard = await read("src/components/teacher/TeacherDashboard.tsx");
  const initialLoad = section(
    dashboard,
    "/* Chargement initial de la séance ouverte — OFFLINE OK */",
    "// Charger paramètres & périodes",
  );
  const syncNow = section(
    dashboard,
    "async function syncNow()",
    "useEffect(() => {\n    registerServiceWorker()",
  );

  assert.match(dashboard, /isTeacherSessionLocallyFinalized/);
  assert.match(initialLoad, /cacheGet\("teacher:inst:basics"\)/);
  assert.match(initialLoad, /serverAlreadyFinished/);
  assert.match(initialLoad, /localAlreadyFinished/);
  assert.match(initialLoad, /cacheSet\("teacher:local-open", null\)/);
  assert.match(syncNow, /serverAlreadyFinished/);
  assert.match(syncNow, /localAlreadyFinished/);
  assert.match(syncNow, /openServer && !serverAlreadyFinished/);
  assert.match(syncNow, /else if \(openLocal\?\.local_relay\)/);
  assert.match(syncNow, /if \(localAlreadyFinished\) setOpen\(null\)/);
  assert.match(syncNow, /else setOpen\(openLocal\)/);
});
