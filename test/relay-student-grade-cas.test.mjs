import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260815055000_relay_student_grade_cas_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

test("LOT4A CAS: la version de base est comparée sous verrou", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /v_current_version <> p_base_server_version/);
  assert.match(migration, /RETURN QUERY SELECT\s+false,/s);
});

test("LOT4A CAS: le contexte causal alimente le trigger historique", () => {
  assert.match(migration, /set_config\('mon_cahier\.relay_operation_id'/);
  assert.match(migration, /set_config\('mon_cahier\.relay_source', 'relay'/);
  assert.match(migration, /mon_cahier\.relay_base_server_version/);
  assert.match(migration, /mon_cahier\.relay_payload_fingerprint/);
});

test("LOT4A CAS: insertion, mise à jour et suppression passent par une seule RPC", () => {
  assert.match(migration, /UPDATE public\.student_grades/);
  assert.match(migration, /INSERT INTO public\.student_grades/);
  assert.match(migration, /DELETE FROM public\.student_grades/);
  assert.match(migration, /Une suppression déjà matérialisée est idempotente/);
});

test("LOT4A CAS: la RPC est réservée au service Cloud", () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /TO service_role/);
});
