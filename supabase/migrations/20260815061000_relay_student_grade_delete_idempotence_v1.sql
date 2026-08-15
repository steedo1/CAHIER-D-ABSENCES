-- LOT 4A.3 — une suppression relayée acceptée crée toujours une nouvelle version.
-- Le cœur CAS garde sa logique, et ce wrapper transforme le seul cas idempotent
-- (note déjà absente, base encore courante) en événement causal historisé.

ALTER FUNCTION public.relay_apply_student_grade_v1(
  uuid, uuid, text, bigint, text, uuid, text, text, uuid, uuid, numeric, text
) RENAME TO relay_apply_student_grade_v1_core;

CREATE OR REPLACE FUNCTION public.relay_apply_student_grade_v1(
  p_institution_id uuid,
  p_entity_id uuid,
  p_action text,
  p_base_server_version bigint,
  p_operation_id text,
  p_actor_profile_id uuid,
  p_origin_device_id text,
  p_payload_fingerprint text,
  p_evaluation_id uuid DEFAULT NULL,
  p_student_id uuid DEFAULT NULL,
  p_score numeric DEFAULT NULL,
  p_comment text DEFAULT NULL
)
RETURNS TABLE (
  applied boolean,
  server_version bigint,
  current_action text,
  current_payload jsonb,
  cloud_entity_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result record;
  v_server_version bigint;
BEGIN
  SELECT * INTO v_result
  FROM public.relay_apply_student_grade_v1_core(
    p_institution_id,
    p_entity_id,
    p_action,
    p_base_server_version,
    p_operation_id,
    p_actor_profile_id,
    p_origin_device_id,
    p_payload_fingerprint,
    p_evaluation_id,
    p_student_id,
    p_score,
    p_comment
  );

  IF NOT (
    v_result.applied = true
    AND p_action = 'delete'
    AND v_result.server_version = p_base_server_version
  ) THEN
    RETURN QUERY SELECT
      v_result.applied::boolean,
      v_result.server_version::bigint,
      v_result.current_action::text,
      v_result.current_payload::jsonb,
      v_result.cloud_entity_id::uuid;
    RETURN;
  END IF;

  -- Le verrou advisory acquis par le cœur CAS est transactionnel et reste tenu ici.
  INSERT INTO public.relay_entity_versions(
    institution_id,
    entity_type,
    entity_id,
    server_version,
    current_action,
    current_payload,
    last_operation_id,
    last_source,
    last_actor_profile_id,
    last_origin_device_id,
    last_base_server_version,
    last_payload_fingerprint,
    accepted_at
  ) VALUES (
    p_institution_id,
    'student_grade',
    p_entity_id::text,
    1,
    'delete',
    NULL,
    p_operation_id,
    'relay',
    p_actor_profile_id,
    p_origin_device_id,
    p_base_server_version,
    p_payload_fingerprint,
    now()
  )
  ON CONFLICT (institution_id, entity_type, entity_id) DO UPDATE SET
    server_version = public.relay_entity_versions.server_version + 1,
    current_action = 'delete',
    current_payload = NULL,
    last_operation_id = EXCLUDED.last_operation_id,
    last_source = 'relay',
    last_actor_profile_id = EXCLUDED.last_actor_profile_id,
    last_origin_device_id = EXCLUDED.last_origin_device_id,
    last_base_server_version = EXCLUDED.last_base_server_version,
    last_payload_fingerprint = EXCLUDED.last_payload_fingerprint,
    accepted_at = EXCLUDED.accepted_at
  RETURNING public.relay_entity_versions.server_version INTO v_server_version;

  INSERT INTO public.relay_entity_history(
    institution_id,
    entity_type,
    entity_id,
    server_version,
    action,
    payload,
    operation_id,
    source,
    actor_profile_id,
    origin_device_id,
    base_server_version,
    payload_fingerprint,
    accepted_at
  ) VALUES (
    p_institution_id,
    'student_grade',
    p_entity_id::text,
    v_server_version,
    'delete',
    NULL,
    p_operation_id,
    'relay',
    p_actor_profile_id,
    p_origin_device_id,
    p_base_server_version,
    p_payload_fingerprint,
    now()
  );

  RETURN QUERY SELECT
    true,
    v_server_version,
    'delete'::text,
    NULL::jsonb,
    p_entity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.relay_apply_student_grade_v1(
  uuid, uuid, text, bigint, text, uuid, text, text, uuid, uuid, numeric, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relay_apply_student_grade_v1(
  uuid, uuid, text, bigint, text, uuid, text, text, uuid, uuid, numeric, text
) TO service_role;

REVOKE ALL ON FUNCTION public.relay_apply_student_grade_v1_core(
  uuid, uuid, text, bigint, text, uuid, text, text, uuid, uuid, numeric, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relay_apply_student_grade_v1_core(
  uuid, uuid, text, bigint, text, uuid, text, text, uuid, uuid, numeric, text
) TO service_role;
