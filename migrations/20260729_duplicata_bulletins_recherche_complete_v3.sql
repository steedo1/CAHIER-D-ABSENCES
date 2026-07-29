-- Mon Cahier - Duplicata de bulletin par recherche eleve
-- Permet a l'administrateur de rechercher un eleve par annee scolaire,
-- de choisir une periode et d'imprimer directement un duplicata.
-- Si le registre a ete active apres l'impression historique, Mon Cahier
-- enregistre l'original presume puis le duplicata dans la meme transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_official_bulletin_batch(
  p_institution_id uuid,
  p_documents jsonb,
  p_generated_by uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  issue_id uuid,
  source_id text,
  official_number text,
  issued_at timestamptz,
  event_id uuid,
  print_kind text,
  duplicate_number integer,
  generated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc jsonb;
  v_issue public.official_document_issues%ROWTYPE;
  v_event public.official_document_print_events%ROWTYPE;
  v_source_id text;
  v_official_number text;
  v_snapshot jsonb;
  v_snapshot_hash text;
  v_qr_code text;
  v_has_original boolean;
  v_duplicate_number integer;
  v_qr_updated integer;
  v_force_duplicate boolean := COALESCE((p_metadata->>'force_duplicate')::boolean, false);
BEGIN
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'institution_required';
  END IF;

  IF p_documents IS NULL OR jsonb_typeof(p_documents) <> 'array' THEN
    RAISE EXCEPTION 'invalid_bulletin_documents';
  END IF;

  IF jsonb_array_length(p_documents) < 1
     OR jsonb_array_length(p_documents) > 300 THEN
    RAISE EXCEPTION 'invalid_bulletin_documents';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT NULLIF(btrim(value->>'source_id'), '') AS source_id, count(*) AS n
      FROM jsonb_array_elements(p_documents)
      GROUP BY NULLIF(btrim(value->>'source_id'), '')
    ) d
    WHERE d.source_id IS NULL OR d.n > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_or_missing_bulletin_source_id';
  END IF;

  FOR v_doc IN SELECT value FROM jsonb_array_elements(p_documents)
  LOOP
    v_source_id := NULLIF(btrim(v_doc->>'source_id'), '');
    v_official_number := NULLIF(btrim(v_doc->>'official_number'), '');
    v_snapshot := v_doc->'snapshot';
    v_snapshot_hash := NULLIF(btrim(v_doc->>'snapshot_hash'), '');
    v_qr_code := NULLIF(upper(btrim(v_doc->>'qr_code')), '');

    IF v_source_id IS NULL
       OR v_official_number IS NULL
       OR v_snapshot IS NULL
       OR v_snapshot = 'null'::jsonb
       OR v_snapshot_hash IS NULL THEN
      RAISE EXCEPTION 'invalid_bulletin_document';
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_institution_id::text || '|bulletin|' || v_source_id, 0)
    );

    SELECT odi.*
      INTO v_issue
    FROM public.official_document_issues odi
    WHERE odi.institution_id = p_institution_id
      AND odi.document_type = 'bulletin'
      AND odi.source_id = v_source_id
      AND odi.source_version = 1
    FOR UPDATE;

    IF FOUND THEN
      IF v_issue.snapshot_hash <> v_snapshot_hash THEN
        RAISE EXCEPTION 'official_bulletin_changed:%', v_source_id;
      END IF;
    ELSE
      INSERT INTO public.official_document_issues (
        institution_id,
        document_type,
        source_id,
        source_version,
        official_number,
        beneficiary_id,
        beneficiary_name,
        academic_year,
        class_id,
        class_label,
        period_key,
        period_label,
        issued_by,
        snapshot,
        snapshot_hash,
        status
      ) VALUES (
        p_institution_id,
        'bulletin',
        v_source_id,
        1,
        v_official_number,
        NULLIF(btrim(v_doc->>'beneficiary_id'), '')::uuid,
        NULLIF(btrim(v_doc->>'beneficiary_name'), ''),
        NULLIF(btrim(v_doc->>'academic_year'), ''),
        NULLIF(btrim(v_doc->>'class_id'), '')::uuid,
        NULLIF(btrim(v_doc->>'class_label'), ''),
        NULLIF(btrim(v_doc->>'period_key'), ''),
        NULLIF(btrim(v_doc->>'period_label'), ''),
        p_generated_by,
        v_snapshot,
        v_snapshot_hash,
        'valid'
      )
      RETURNING * INTO v_issue;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.official_document_print_events e
      WHERE e.issue_id = v_issue.id
        AND e.print_kind = 'original'
    ) INTO v_has_original;

    IF NOT v_has_original THEN
      INSERT INTO public.official_document_print_events (
        issue_id,
        print_kind,
        duplicate_number,
        reason,
        generated_by,
        metadata
      ) VALUES (
        v_issue.id,
        'original',
        NULL,
        NULL,
        p_generated_by,
        COALESCE(p_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'source_id', v_source_id,
            'original_registered_from_duplicate', v_force_duplicate
          )
      )
      RETURNING * INTO v_event;
    END IF;

    -- Demande explicite depuis Duplicata > Bulletins : l'impression doit etre
    -- un duplicata meme si le registre vient seulement d'etre active.
    IF v_force_duplicate OR v_has_original THEN
      SELECT COALESCE(MAX(e.duplicate_number), 0) + 1
        INTO v_duplicate_number
      FROM public.official_document_print_events e
      WHERE e.issue_id = v_issue.id
        AND e.print_kind = 'duplicate';

      INSERT INTO public.official_document_print_events (
        issue_id,
        print_kind,
        duplicate_number,
        reason,
        generated_by,
        metadata
      ) VALUES (
        v_issue.id,
        'duplicate',
        v_duplicate_number,
        NULLIF(btrim(COALESCE(p_reason, '')), ''),
        p_generated_by,
        COALESCE(p_metadata, '{}'::jsonb)
          || jsonb_build_object('source_id', v_source_id)
      )
      RETURNING * INTO v_event;
    END IF;

    IF v_qr_code IS NOT NULL THEN
      IF to_regclass('public.bulletin_qr_codes') IS NULL THEN
        RAISE EXCEPTION 'bulletin_qr_table_not_found';
      END IF;

      EXECUTE
        'UPDATE public.bulletin_qr_codes
            SET official_issue_id = $1
          WHERE bulletin_key = $2
            AND code = $3'
      USING v_issue.id, v_source_id, v_qr_code;
      GET DIAGNOSTICS v_qr_updated = ROW_COUNT;

      IF v_qr_updated <> 1 THEN
        RAISE EXCEPTION 'bulletin_qr_not_found:%', v_source_id;
      END IF;
    END IF;

    issue_id := v_issue.id;
    source_id := v_source_id;
    official_number := v_issue.official_number;
    issued_at := v_issue.issued_at;
    event_id := v_event.id;
    print_kind := v_event.print_kind;
    duplicate_number := v_event.duplicate_number;
    generated_at := v_event.generated_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMIT;
