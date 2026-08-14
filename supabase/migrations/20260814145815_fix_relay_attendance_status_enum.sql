BEGIN;

CREATE OR REPLACE FUNCTION public.apply_relay_attendance_call_v2(
  p_institution_id uuid,
  p_session_id uuid,
  p_operation_id text,
  p_captured_at_device timestamptz,
  p_marks jsonb
)
RETURNS TABLE(
  status text,
  changed boolean,
  upserted integer,
  deleted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_end timestamptz;
  expected_minutes integer;
  previous_captured timestamptz;
  previous_operation text;
  previous_fingerprint text;
  payload_fingerprint text;
  canonical_marks jsonb;
  deleted_count integer := 0;
  upserted_count integer := 0;
  call_updated_count integer := 0;
BEGIN
  IF p_operation_id IS NULL
     OR btrim(p_operation_id) = ''
     OR length(p_operation_id) > 160
     OR p_captured_at_device IS NULL
     OR jsonb_typeof(p_marks) <> 'array' THEN
    RETURN QUERY SELECT 'attendance_payload_invalid'::text, false, 0, 0;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_marks) item
    WHERE COALESCE(item->>'student_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(item->>'status', '') NOT IN ('present', 'absent', 'late')
       OR length(COALESCE(item->>'comment', '')) > 500
       OR (
         COALESCE(item->>'status', '') = 'late'
         AND (
           COALESCE(item->>'late_minutes', '0') !~ '^[0-9]+$'
           OR (item->>'late_minutes')::integer > 1440
         )
       )
  ) OR (
    SELECT count(*) <> count(DISTINCT item->>'student_id')
    FROM jsonb_array_elements(p_marks) item
  ) THEN
    RETURN QUERY SELECT 'attendance_payload_invalid'::text, false, 0, 0;
    RETURN;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'student_id', item->>'student_id',
        'status', item->>'status',
        'late_minutes', CASE
          WHEN item->>'status' = 'late'
            THEN GREATEST(0, COALESCE((item->>'late_minutes')::integer, 0))
          ELSE 0
        END,
        'comment', NULLIF(item->>'comment', '')
      )
      ORDER BY item->>'student_id'
    ),
    '[]'::jsonb
  )
  INTO canonical_marks
  FROM jsonb_array_elements(p_marks) item;

  payload_fingerprint := md5(canonical_marks::text);

  SELECT session.ended_at, GREATEST(1, COALESCE(session.expected_minutes, 60))
    INTO current_end, expected_minutes
  FROM public.teacher_sessions session
  WHERE session.id = p_session_id
    AND session.institution_id = p_institution_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'session_not_found'::text, false, 0, 0;
    RETURN;
  END IF;

  SELECT
    causality.last_captured_at_device,
    causality.last_operation_id,
    causality.last_payload_fingerprint
    INTO previous_captured, previous_operation, previous_fingerprint
  FROM public.relay_attendance_session_causality causality
  WHERE causality.institution_id = p_institution_id
    AND causality.session_id = p_session_id
  FOR UPDATE;

  IF previous_operation = p_operation_id THEN
    IF previous_captured = p_captured_at_device
       AND previous_fingerprint = payload_fingerprint THEN
      RETURN QUERY SELECT 'already_applied'::text, false, 0, 0;
    ELSE
      RETURN QUERY SELECT 'attendance_operation_payload_conflict'::text, false, 0, 0;
    END IF;
    RETURN;
  END IF;

  IF current_end IS NOT NULL THEN
    RETURN QUERY SELECT 'session_closed'::text, false, 0, 0;
    RETURN;
  END IF;
  IF previous_captured IS NOT NULL AND previous_captured > p_captured_at_device THEN
    RETURN QUERY SELECT 'attendance_operation_stale'::text, false, 0, 0;
    RETURN;
  END IF;
  IF previous_captured = p_captured_at_device
     AND previous_operation IS DISTINCT FROM p_operation_id THEN
    RETURN QUERY SELECT 'attendance_operation_ambiguous'::text, false, 0, 0;
    RETURN;
  END IF;

  INSERT INTO public.relay_attendance_session_causality(
    institution_id,
    session_id,
    last_captured_at_device,
    last_operation_id,
    last_payload_fingerprint,
    updated_at
  ) VALUES (
    p_institution_id,
    p_session_id,
    p_captured_at_device,
    p_operation_id,
    payload_fingerprint,
    clock_timestamp()
  )
  ON CONFLICT (institution_id, session_id) DO UPDATE SET
    last_captured_at_device = EXCLUDED.last_captured_at_device,
    last_operation_id = EXCLUDED.last_operation_id,
    last_payload_fingerprint = EXCLUDED.last_payload_fingerprint,
    updated_at = EXCLUDED.updated_at;

  PERFORM set_config('moncahier.relay_captured_at_device', p_captured_at_device::text, true);
  PERFORM set_config('moncahier.relay_operation_id', p_operation_id, true);
  PERFORM set_config('moncahier.attendance_payload_fingerprint', payload_fingerprint, true);

  DELETE FROM public.attendance_marks mark
  USING jsonb_array_elements(canonical_marks) item
  WHERE mark.session_id = p_session_id
    AND mark.student_id = (item->>'student_id')::uuid
    AND item->>'status' = 'present';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  INSERT INTO public.attendance_marks(
    session_id, student_id, status, minutes_late, hours_absent, reason
  )
  SELECT
    p_session_id,
    (item->>'student_id')::uuid,
    (item->>'status')::public.attendance_status,
    CASE WHEN item->>'status' = 'late'
      THEN GREATEST(0, COALESCE((item->>'late_minutes')::integer, 0)) ELSE 0 END,
    CASE WHEN item->>'status' = 'absent'
      THEN round((expected_minutes::numeric / 60), 2) ELSE 0 END,
    NULLIF(item->>'comment', '')
  FROM jsonb_array_elements(canonical_marks) item
  WHERE item->>'status' IN ('absent', 'late')
  ON CONFLICT (session_id, student_id) DO UPDATE SET
    status = EXCLUDED.status,
    minutes_late = EXCLUDED.minutes_late,
    hours_absent = EXCLUDED.hours_absent,
    reason = EXCLUDED.reason
  WHERE (
    public.attendance_marks.status,
    public.attendance_marks.minutes_late,
    public.attendance_marks.hours_absent,
    public.attendance_marks.reason
  ) IS DISTINCT FROM (
    EXCLUDED.status,
    EXCLUDED.minutes_late,
    EXCLUDED.hours_absent,
    EXCLUDED.reason
  );
  GET DIAGNOSTICS upserted_count = ROW_COUNT;

  UPDATE public.teacher_sessions session
  SET actual_call_at = CASE
    WHEN session.actual_call_at IS NULL OR session.actual_call_at > p_captured_at_device
      THEN p_captured_at_device
    ELSE session.actual_call_at
  END
  WHERE session.id = p_session_id
    AND session.institution_id = p_institution_id
    AND session.ended_at IS NULL
    AND (
      session.actual_call_at IS NULL
      OR session.actual_call_at > p_captured_at_device
    );
  GET DIAGNOSTICS call_updated_count = ROW_COUNT;

  RETURN QUERY SELECT
    'applied'::text,
    (deleted_count + upserted_count + call_updated_count) > 0,
    upserted_count,
    deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_relay_attendance_call_v2(uuid, uuid, text, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_relay_attendance_call_v2(uuid, uuid, text, timestamptz, jsonb)
  TO service_role;

COMMIT;
