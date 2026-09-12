import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/app/admin/absences/appels/page.tsx", import.meta.url),
  "utf8",
);

test("surveillance des appels rafraichit automatiquement les donnees Cloud", () => {
  assert.match(source, /adminAttendancePollDelay/);
  assert.match(source, /load\(\{ background: true \}\)/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /window\.addEventListener\("online", refreshNow\)/);
  assert.match(source, /window\.addEventListener\("focus", refreshNow\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", refreshNow\)/);
  assert.match(source, /const liveToday = startDate === today && endDate === today/);
  assert.match(source, /if \(stopped \|\| !liveToday\) return/);
  assert.match(source, /if \(!liveToday\) return/);
});

test("l'historique charge ses seances en une requete et ne reste pas en polling", () => {
  assert.match(source, /daily-sessions\?start_date=/);
  assert.match(source, /&end_date=/);
  assert.doesNotMatch(source, /Promise\.all\(\s*dates\.map/);
  assert.match(source, /if \(liveToday\) scheduleNext\(\)/);
});

test("le rafraichissement silencieux ne remplace pas l'ecran par un spinner", () => {
  assert.match(source, /if \(!background\) \{\s*setLoading\(true\)/s);
  assert.match(source, /if \(!background\) setExpandedTeacher\(null\)/);
  assert.match(source, /if \(background && refreshInFlightRef\.current\) return/);
});
