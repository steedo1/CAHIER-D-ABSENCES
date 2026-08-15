-- LOT 4A.2 — écriture atomique CAS des notes relayées.
-- La validation métier reste dans relay-cloud-sync.ts ; cette fonction garantit
-- qu'une opération fondée sur une version obsolète ne peut jamais écraser le Cloud.

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
  v_current_version bigint := 0;
  v_current_action text := 'delete';
  v_current_payload jsonb := NULL;
  v_version_found boolean := false;
  v_existing public.student_grades%ROWTYPE;
  v_existing_found boolean := false;
  v_existing_institution_id uuid;
  v_evaluation_institution_id uuid;
BEGIN
  IF p_institution_id IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'relay_student_grade_identity_required' USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'relay_student_grade_action_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_base_server_version IS NULL OR p_base_server_version < 0 THEN
    RAISE EXCEPTION 'relay_student_grade_base_version_invalid' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_operation_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'relay_student_grade_operation_id_required' USING ERRCODE = '22023';
  END IF;

  -- Sérialise aussi le cas « entité encore absente », où aucun row lock n'existe.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_institution_id::text || ':student_grade:' || p_entity_id::text,
      0
    )
  );

  SELECT v.server_version, v.current_action, v.current_payload
    INTO v_current_version, v_current_action, v_current_payload
  FROM public.relay_entity_versions v
  WHERE v.institution_id = p_institution_id
    AND v.entity_type = 'student_grade'
    AND v.entity_id = p_entity_id::text
  FOR UPDATE;
  v_version_found := FOUND;

  SELECT sg.*
    INTO v_existing
  FROM public.student_grades sg
  WHERE sg.id = p_entity_id
  FOR UPDATE;
  v_existing_found := FOUND;

  IF v_existing_found THEN
    SELECT c.institution_id
      INTO v_existing_institution_id
    FROM public.grade_evaluations ge
    JOIN public.classes c ON c.id = ge.class_id
    WHERE ge.id = v_existing.evaluation_id;
    IF v_existing_institution_id IS DISTINCT FROM p_institution_id THEN
      RAISE EXCEPTION 'relay_student_grade_institution_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NOT v_version_found THEN
      RAISE EXCEPTION 'relay_student_grade_version_missing' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NOT v_version_found THEN
    v_current_version := 0;
    v_current_action := CASE WHEN v_existing_found THEN 'upsert' ELSE 'delete' END;
    v_current_payload := NULL;
  END IF;

  IF v_current_version <> p_base_server_version THEN
    RETURN QUERY SELECT
      false,
      v_current_version,
      v_current_action,
      v_current_payload,
      p_entity_id;
    RETURN;
  END IF;

  IF p_action = 'upsert' THEN
    IF p_evaluation_id IS NULL OR p_student_id IS NULL OR p_actor_profile_id IS NULL THEN
      RAISE EXCEPTION 'relay_student_grade_payload_required' USING ERRCODE = '22023';
    END IF;

    SELECT c.institution_id
      INTO v_evaluation_institution_id
    FROM public.grade_evaluations ge
    JOIN public.classes c ON c.id = ge.class_id
    WHERE ge.id = p_evaluation_id;
    IF v_evaluation_institution_id IS NULL THEN
      RAISE EXCEPTION 'relay_student_grade_evaluation_not_found' USING ERRCODE = '23503';
    END IF;
    IF v_evaluation_institution_id <> p_institution_id THEN
      RAISE EXCEPTION 'relay_student_grade_institution_mismatch' USING ERRCODE = '23514';
    END IF;

    IF v_existing_found AND (
      v_existing.evaluation_id <> p_evaluation_id OR
      v_existing.student_id <> p_student_id
    ) THEN
      RAISE EXCEPTION 'relay_student_grade_identity_conflict' USING ERRCODE = '23505';
    END IF;

    PERFORM set_config('mon_cahier.relay_operation_id', p_operation_id, true);
    PERFORM set_config('mon_cahier.relay_source', 'relay', true);
    PERFORM set_config(
      'mon_cahier.relay_actor_profile_id',
      COALESCE(p_actor_profile_id::text, ''),
      true
    );
    PERFORM set_config(
      'mon_cahier.relay_origin_device_id',
      COALESCE(p_origin_device_id, ''),
      true
    );
    PERFORM set_config(
      'mon_cahier.relay_base_server_version',
      p_base_server_version::text,
      true
    );
    PERFORM set_config(
      'mon_cahier.relay_payload_fingerprint',
      COALESCE(p_payload_fingerprint, ''),
      true
    );

    IF v_existing_found THEN
      UPDATE public.student_grades
      SET score = p_score,
          comment = p_comment,
          updated_by = p_actor_profile_id
      WHERE id = p_entity_id;
    ELSE
      INSERT INTO public.student_grades(
        id,
        evaluation_id,
        student_id,
        score,
        comment,
        updated_by
      ) VALUES (
        p_entity_id,
        p_evaluation_id,
        p_student_id,
        p_score,
        p_comment,
        p_actor_profile_id
      );
    END IF;
  ELSE
    -- Une suppression déjà matérialisée est idempotente à version égale.
    IF NOT v_existing_found THEN
      RETURN QUERY SELECT
        true,
        v_current_version,
        'delete'::text,
        NULL::jsonb,
        p_entity_id;
      RETURN;
    END IF;

    PERFORM set_config('mon_cahier.relay_operation_id', p_operation_id, true);
    PERFORM set_config('mon_cahier.relay_source', 'relay', true);
    PERFORM set_config(
      'mon_cahier.relay_actor_profile_id',
      COALESCE(p_actor_profile_id::text, ''),
      true
    );
    PERFORM set_config(
      'mon_cahier.relay_origin_device_id',
      COALESCE(p_origin_device_id, ''),
      true
    );
    PERFORM set_config(
      'mon_cahier.relay_base_server_version',
      p_base_server_version::text,
      true
    );
    PERFORM set_config(
      'mon_cahier.relay_payload_fingerprint',
      COALESCE(p_payload_fingerprint, ''),
      true
    );

    DELETE FROM public.student_grades WHERE id = p_entity_id;
  END IF;

  SELECT v.server_version, v.current_action, v.current_payload
    INTO v_current_version, v_current_action, v_current_payload
  FROM public.relay_entity_versions v
  WHERE v.institution_id = p_institution_id
    AND v.entity_type = 'student_grade'
    AND v.entity_id = p_entity_id::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'relay_student_grade_version_not_recorded' USING ERRCODE = '55000';
  END IF;

  RETURN QUERY SELECT
    true,
    v_current_version,
    v_current_action,
    v_current_payload,
    p_entity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.relay_apply_student_grade_v1(
  uuid, uuid, text, bigint, text, uuid, text, text, uuid, uuid, numeric, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relay_apply_student_grade_v1(
  uuid, uuid, text, bigint, text, uuid, text, text, uuid, uuid, numeric, text
) TO service_role;
