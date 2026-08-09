import assert from "node:assert/strict";
import { test } from "node:test";
import { decideTeacherSessionStart } from "../src/lib/teacher-session-start-policy";

const base = {
  cloud_available: true,
  presence_enabled: true,
  allow_gps_fallback: true,
  relay_configured: true,
  relay_reachable: true,
  relay_schedule_matches: true,
};

test("relais présent et concordant : la preuve réseau local reste prioritaire", () => {
  assert.deepEqual(decideTeacherSessionStart(base), {
    mode: "cloud_relay_presence",
    force_gps: false,
    reason: null,
  });
});

test("relais absent mais Cloud confirmé : le GPS ponctuel est utilisé si autorisé", () => {
  assert.deepEqual(
    decideTeacherSessionStart({ ...base, relay_reachable: false }),
    { mode: "cloud_gps_presence", force_gps: true, reason: null },
  );
});

test("relais obsolète mais Cloud confirmé : aucune preuve relais périmée n'est acceptée", () => {
  assert.equal(
    decideTeacherSessionStart({ ...base, relay_schedule_matches: false }).mode,
    "cloud_gps_presence",
  );
});

test("sans Cloud, seul un relais joignable et concordant autorise l'appel", () => {
  assert.equal(
    decideTeacherSessionStart({ ...base, cloud_available: false }).mode,
    "relay_only",
  );
  assert.equal(
    decideTeacherSessionStart({
      ...base,
      cloud_available: false,
      relay_schedule_matches: false,
    }).mode,
    "blocked",
  );
});

test("le téléphone de classe n'est pas concerné par cette politique GPS professeur", () => {
  const source = decideTeacherSessionStart.toString();
  assert.equal(source.includes("class_device"), false);
});
