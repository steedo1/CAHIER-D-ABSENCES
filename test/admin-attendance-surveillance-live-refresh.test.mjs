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
});

test("le rafraichissement silencieux ne remplace pas l'ecran par un spinner", () => {
  assert.match(source, /if \(!background\) \{\s*setLoading\(true\)/s);
  assert.match(source, /if \(!background\) setExpandedTeacher\(null\)/);
  assert.match(source, /if \(background && refreshInFlightRef\.current\) return/);
});
