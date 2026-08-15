-- LOT 4A.1 — version logique et historique immuable des notes synchronisables.
-- Additif : aucune colonne métier existante n'est modifiée.

CREATE TABLE IF NOT EXISTS public.relay_entity_versions (
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  server_version bigint NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  current_action text NOT NULL DEFAULT 'upsert' CHECK (current_action IN ('upsert', 'delete')),
  current_payload jsonb,
  last_operation_id text,
  last_source text NOT NULL DEFAULT 'cloud',
  last_actor_profile_id uuid,
  last_origin_device_id text,
  last_base_server_version bigint CHECK (last_base_server_version IS NULL OR last_base_server_version >= 0),
  last_payload_fingerprint text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS relay_entity_versions_lookup
  ON public.relay_entity_versions(institution_id, entity_type, server_version);

CREATE TABLE IF NOT EXISTS public.relay_entity_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  server_version bigint NOT NULL CHECK (server_version > 0),
  action text NOT NULL CHECK (action IN ('upsert', 'delete')),
  payload jsonb,
  operation_id text,
  source text NOT NULL,
  actor_profile_id uuid,
  origin_device_id text,
  base_server_version bigint CHECK (base_server_version IS NULL OR base_server_version >= 0),
  payload_fingerprint text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, entity_type, entity_id, server_version)
);

CREATE INDEX IF NOT EXISTS relay_entity_history_entity_time
  ON public.relay_entity_history(institution_id, entity_type, entity_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS relay_entity_history_operation
  ON public.relay_entity_history(institution_id, operation_id)
  WHERE operation_id IS NOT NULL;

ALTER TABLE public.relay_entity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relay_entity_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.relay_entity_versions FROM anon, authenticated;
REVOKE ALL ON public.relay_entity_history FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_relay_entity_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'relay_entity_history_is_immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_relay_entity_history_immutable ON public.relay_entity_history;
CREATE TRIGGER trg_relay_entity_history_immutable
BEFORE UPDATE OR DELETE ON public.relay_entity_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_relay_entity_history_mutation();

CREATE OR REPLACE FUNCTION public.track_relay_student_grade_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.student_grades%ROWTYPE;
  v_entity_id text;
  v_evaluation_id uuid;
  v_institution_id uuid;
  v_action text;
  v_payload jsonb;
  v_operation_id text;
  v_source text;
  v_actor_profile_id uuid;
  v_origin_device_id text;
  v_base_server_version bigint;
  v_payload_fingerprint text;
  v_server_version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    v_action := 'delete';
    v_payload := NULL;
  ELSE
    v_row := NEW;
    v_action := 'upsert';
    v_payload := jsonb_build_object(
      'id', NEW.id,
      'evaluation_id', NEW.evaluation_id,
      'student_id', NEW.student_id,
      'score', NEW.score,
      'comment', NEW.comment,
      'updated_by', NEW.updated_by,
      'updated_at', NEW.updated_at
    );
  END IF;

  v_entity_id := v_row.id::text;
  v_evaluation_id := v_row.evaluation_id;

  SELECT c.institution_id
    INTO v_institution_id
  FROM public.grade_evaluations ge
  JOIN public.classes c ON c.id = ge.class_id
  WHERE ge.id = v_evaluation_id;

  IF v_institution_id IS NULL THEN
    SELECT version_row.institution_id
      INTO v_institution_id
    FROM public.relay_entity_versions version_row
    WHERE version_row.entity_type = 'student_grade'
      AND version_row.entity_id = v_entity_id
    LIMIT 1;
  END IF;

  IF v_institution_id IS NULL THEN
    RAISE EXCEPTION 'relay_student_grade_institution_not_found' USING ERRCODE = '23503';
  END IF;

  v_operation_id := NULLIF(current_setting('mon_cahier.relay_operation_id', true), '');
  v_source := COALESCE(
    NULLIF(current_setting('mon_cahier.relay_source', true), ''),
    CASE WHEN v_operation_id IS NULL THEN 'cloud' ELSE 'relay' END
  );
  v_origin_device_id := NULLIF(current_setting('mon_cahier.relay_origin_device_id', true), '');
  v_payload_fingerprint := NULLIF(current_setting('mon_cahier.relay_payload_fingerprint', true), '');

  BEGIN
    v_base_server_version := NULLIF(
      current_setting('mon_cahier.relay_base_server_version', true),
      ''
    )::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    v_base_server_version := NULL;
  END;

  BEGIN
    v_actor_profile_id := NULLIF(
      current_setting('mon_cahier.relay_actor_profile_id', true),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_actor_profile_id := NULL;
  END;
  v_actor_profile_id := COALESCE(v_actor_profile_id, v_row.updated_by);

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
    v_institution_id,
    'student_grade',
    v_entity_id,
    1,
    v_action,
    v_payload,
    v_operation_id,
    v_source,
    v_actor_profile_id,
    v_origin_device_id,
    v_base_server_version,
    v_payload_fingerprint,
    now()
  )
  ON CONFLICT (institution_id, entity_type, entity_id) DO UPDATE SET
    server_version = public.relay_entity_versions.server_version + 1,
    current_action = EXCLUDED.current_action,
    current_payload = EXCLUDED.current_payload,
    last_operation_id = EXCLUDED.last_operation_id,
    last_source = EXCLUDED.last_source,
    last_actor_profile_id = EXCLUDED.last_actor_profile_id,
    last_origin_device_id = EXCLUDED.last_origin_device_id,
    last_base_server_version = EXCLUDED.last_base_server_version,
    last_payload_fingerprint = EXCLUDED.last_payload_fingerprint,
    accepted_at = EXCLUDED.accepted_at
  RETURNING server_version INTO v_server_version;

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
    v_institution_id,
    'student_grade',
    v_entity_id,
    v_server_version,
    v_action,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE v_payload END,
    v_operation_id,
    v_source,
    v_actor_profile_id,
    v_origin_device_id,
    v_base_server_version,
    v_payload_fingerprint,
    now()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Les notes déjà présentes deviennent la version 1 de référence.
INSERT INTO public.relay_entity_versions(
  institution_id,
  entity_type,
  entity_id,
  server_version,
  current_action,
  current_payload,
  last_source,
  last_actor_profile_id,
  accepted_at
)
SELECT
  c.institution_id,
  'student_grade',
  sg.id::text,
  1,
  'upsert',
  jsonb_build_object(
    'id', sg.id,
    'evaluation_id', sg.evaluation_id,
    'student_id', sg.student_id,
    'score', sg.score,
    'comment', sg.comment,
    'updated_by', sg.updated_by,
    'updated_at', sg.updated_at
  ),
  'baseline',
  sg.updated_by,
  sg.updated_at
FROM public.student_grades sg
JOIN public.grade_evaluations ge ON ge.id = sg.evaluation_id
JOIN public.classes c ON c.id = ge.class_id
ON CONFLICT (institution_id, entity_type, entity_id) DO NOTHING;

INSERT INTO public.relay_entity_history(
  institution_id,
  entity_type,
  entity_id,
  server_version,
  action,
  payload,
  source,
  actor_profile_id,
  accepted_at
)
SELECT
  version_row.institution_id,
  version_row.entity_type,
  version_row.entity_id,
  1,
  'upsert',
  version_row.current_payload,
  'baseline',
  version_row.last_actor_profile_id,
  version_row.accepted_at
FROM public.relay_entity_versions version_row
WHERE version_row.entity_type = 'student_grade'
  AND version_row.server_version = 1
  AND version_row.current_action = 'upsert'
  AND NOT EXISTS (
    SELECT 1
    FROM public.relay_entity_history history
    WHERE history.institution_id = version_row.institution_id
      AND history.entity_type = version_row.entity_type
      AND history.entity_id = version_row.entity_id
      AND history.server_version = 1
  );

DROP TRIGGER IF EXISTS trg_student_grades_relay_entity_version ON public.student_grades;
CREATE TRIGGER trg_student_grades_relay_entity_version
AFTER INSERT OR UPDATE OR DELETE ON public.student_grades
FOR EACH ROW EXECUTE FUNCTION public.track_relay_student_grade_version();
