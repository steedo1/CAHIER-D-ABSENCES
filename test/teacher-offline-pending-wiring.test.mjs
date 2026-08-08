import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../src/components/teacher/TeacherDashboard.tsx", import.meta.url),
  "utf8",
);

test("le tableau professeur utilise un agrégateur unique pour le compteur", () => {
  assert.match(page, /getTeacherOfflinePendingSummary/);
  assert.match(page, /const pending = pendingSummary\.total/);
  assert.doesNotMatch(page, /const n = await outboxCount\(\)/);
});

test("la synchronisation ne peut plus annoncer tout synchronisé si une file spécialisée reste ouverte", () => {
  assert.match(page, /const summary = await refreshPending\(\)/);
  assert.match(page, /summary\.delivery_unknown > 0/);
  assert.match(page, /summary\.device_pending > 0/);
  assert.match(page, /summary\.relay_secured > 0/);
});

test("la déconnexion compte les ouvertures, appels et fermetures encore à risque", () => {
  assert.match(
    page,
    /let summary = await getTeacherOfflinePendingSummary\([\s\S]*let remaining = summary\.at_risk/,
  );
  assert.doesNotMatch(page, /countUnresolvedTeacherAttendanceOperations/);
  assert.doesNotMatch(page, /unresolvedAttendance/);
});
