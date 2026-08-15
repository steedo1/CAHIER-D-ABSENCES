import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260815061000_relay_student_grade_delete_idempotence_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

test("LOT4A delete: le coeur CAS reste la source de vérité", () => {
  assert.match(migration, /RENAME TO relay_apply_student_grade_v1_core/);
  assert.match(migration, /FROM public\.relay_apply_student_grade_v1_core\(/);
});

test("LOT4A delete: une suppression déjà effective produit une nouvelle version", () => {
  assert.match(migration, /p_action = 'delete'/);
  assert.match(migration, /v_result\.server_version = p_base_server_version/);
  assert.match(
    migration,
    /server_version = public\.relay_entity_versions\.server_version \+ 1/,
  );
  assert.match(migration, /INSERT INTO public\.relay_entity_history/);
  assert.match(migration, /'delete'/);
});

test("LOT4A delete: le contexte causal de l'opération reste historisé", () => {
  assert.match(migration, /p_operation_id/);
  assert.match(migration, /p_actor_profile_id/);
  assert.match(migration, /p_origin_device_id/);
  assert.match(migration, /p_base_server_version/);
  assert.match(migration, /p_payload_fingerprint/);
});
