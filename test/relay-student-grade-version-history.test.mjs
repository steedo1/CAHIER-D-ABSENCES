import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260815054000_relay_student_grade_version_history_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

test("LOT4A: le Cloud possède un compteur logique par entité", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.relay_entity_versions/);
  assert.match(migration, /server_version bigint NOT NULL DEFAULT 0/);
  assert.match(migration, /current_action text NOT NULL DEFAULT 'upsert'/);
  assert.match(migration, /current_payload jsonb/);
  assert.match(
    migration,
    /server_version = public\.relay_entity_versions\.server_version \+ 1/,
  );
});

test("LOT4A: chaque mutation de note est historisée de façon immuable", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.relay_entity_history/);
  assert.match(
    migration,
    /UNIQUE \(institution_id, entity_type, entity_id, server_version\)/,
  );
  assert.match(migration, /relay_entity_history_is_immutable/);
  assert.match(
    migration,
    /BEFORE UPDATE OR DELETE ON public\.relay_entity_history/,
  );
  assert.match(
    migration,
    /AFTER INSERT OR UPDATE OR DELETE ON public\.student_grades/,
  );
});

test("LOT4A: le contexte causal du relais est prévu sans casser les écritures Cloud", () => {
  assert.match(migration, /mon_cahier\.relay_operation_id/);
  assert.match(migration, /mon_cahier\.relay_base_server_version/);
  assert.match(migration, /mon_cahier\.relay_origin_device_id/);
  assert.match(migration, /mon_cahier\.relay_payload_fingerprint/);
  assert.match(
    migration,
    /CASE WHEN v_operation_id IS NULL THEN 'cloud' ELSE 'relay' END/,
  );
});

test("LOT4A: les notes existantes sont initialisées en version 1 sans réécriture métier", () => {
  assert.match(migration, /Les notes déjà présentes deviennent la version 1/);
  assert.match(migration, /FROM public\.student_grades sg/);
  assert.match(migration, /'baseline'/);
  assert.match(
    migration,
    /ON CONFLICT \(institution_id, entity_type, entity_id\) DO NOTHING/,
  );
});
