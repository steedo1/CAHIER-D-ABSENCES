import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("le changement de créneau impose la matière automatique courante", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /mode === "relay" \|\| mode === "auto" \|\| mode === "auto-offline"/);
  assert.match(page, /if \(automaticMode\) \{\s*return list\[0\]\?\.id \|\| "";/);
  assert.match(page, /period_id=\$\{encodeURIComponent\(activeConfiguredSlot\.id\)\}/);
});

test("l'API et le relais éliminent une ancienne matière conflictuelle", async () => {
  const [route, relay] = await Promise.all([
    read("src/app/api/class/subjects/route.ts"),
    read("desktop/relay/src/teacher-offline-schedule.mts"),
  ]);

  assert.match(route, /select\("id,subject_id,updated_at"\)/);
  assert.match(route, /currentTimetableSubjectIds/);
  assert.match(route, /periodIdRaw/);
  assert.match(relay, /currentClassDeviceTimetableRows/);
  assert.match(relay, /tt\.updated_at DESC/);
  assert.match(relay, /winnerBySlot\.get\(key\)\?\.subject_id === row\.subject_id/);
});
