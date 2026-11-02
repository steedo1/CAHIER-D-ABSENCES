-- EPC Dimbokro CE1 French Expression écrite, 2026–2027 ONLY.
-- Add the requested /30 scale as a per-subject override; never rescale a
-- student's existing raw score. Existing empty draft gets the actual /30
-- encoded in the primary title while keeping the DB's scale CHECK at 60.
BEGIN;
DO $fix$
DECLARE
  v_institution uuid := '2b897cd4-e1c3-40c3-9569-03e01e1877b4';
  v_class uuid := 'a16963af-84fa-4a99-a085-625965babd13';
  v_subject uuid := '294cc05d-ebd7-408e-83af-e67688d1afed';
  v_evaluation uuid := 'fd70781b-f688-50de-a9db-88c78030e676';
  v_settings jsonb;
  v_report jsonb;
  v_overrides jsonb;
  v_entry jsonb := jsonb_build_object('cycle','primary','level','CE1',
    'track','french','subjectId',v_subject::text,'maxScore',30);
  v_updated integer;
BEGIN
  SELECT settings_json INTO STRICT v_settings FROM institutions
    WHERE id=v_institution FOR UPDATE;
  v_report := v_settings->'franco_arabic_reports_v1';
  IF v_report IS NULL OR v_report->>'enabled' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'EPC grade configuration missing';
  END IF;
  v_overrides := coalesce(v_report->'primarySubjectScales','[]'::jsonb);
  IF jsonb_typeof(v_overrides) <> 'array' OR jsonb_array_length(v_overrides) > 499 OR
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_overrides) x
      WHERE x->>'level'='CE1' AND x->>'track'='french'
        AND x->>'subjectId'=v_subject::text AND x->>'maxScore'<>'30') THEN
    RAISE EXCEPTION 'EPC CE1 subject barème changed concurrently';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM classes c WHERE c.id=v_class AND c.institution_id=v_institution
    AND c.level='CE1' AND c.academic_year='2026-2027' AND c.label ilike '%Français%') THEN
    RAISE EXCEPTION 'Expected CE1 French class missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM grade_evaluations e WHERE e.id=v_evaluation
    AND e.class_id=v_class AND e.subject_id=v_subject
    AND e.title='MCPE:I:E_24D93FC92F3A4CB4:french'
    AND e.scale=10 AND coalesce(e.is_published,false)=false AND e.publication_status='draft'
    AND NOT EXISTS(SELECT 1 FROM student_grades g WHERE g.evaluation_id=e.id)
    AND NOT EXISTS(SELECT 1 FROM grade_published_scores p WHERE p.evaluation_id=e.id)) THEN
    RAISE EXCEPTION 'CE1 evaluation is not an empty unpublished /10 draft; no modification';
  END IF;
  UPDATE grade_evaluations SET
    title='MCPE:I:E_24D93FC92F3A4CB4:french:S30', scale=60, updated_at=now()
    WHERE id=v_evaluation AND class_id=v_class AND subject_id=v_subject;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RAISE EXCEPTION 'Expected one CE1 evaluation update'; END IF;
  IF NOT v_overrides @> jsonb_build_array(v_entry) THEN
    v_overrides := v_overrides || jsonb_build_array(v_entry);
  END IF;
  UPDATE institutions SET settings_json=jsonb_set(settings_json,
    '{franco_arabic_reports_v1,primarySubjectScales}', v_overrides,true)
    WHERE id=v_institution;
END $fix$;
COMMIT;