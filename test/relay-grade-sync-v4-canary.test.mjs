import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260815062000_relay_grade_sync_v4_canary.sql",
    import.meta.url,
  ),
  "utf8",
);

test("LOT4A canary: le moteur versionné est désactivé par défaut", () => {
  assert.match(migration, /grade_sync_v4_enabled boolean NOT NULL DEFAULT false/);
});

test("LOT4A canary: l'activation est portée par le relais, pas globalement par l'école", () => {
  assert.match(migration, /ALTER TABLE public\.relay_sync_devices/);
  assert.doesNotMatch(migration, /UPDATE public\.relay_sync_devices/);
});
