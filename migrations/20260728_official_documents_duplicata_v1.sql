-- Mon Cahier - Registre officiel des duplicatas (reçus et bulletins)
-- Migration additive : aucune table métier existante n'est supprimée ni renommée.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.official_document_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('receipt', 'bulletin')),
  source_id text NOT NULL,
  source_version integer NOT NULL DEFAULT 1 CHECK (source_version > 0),
  official_number text NOT NULL,
  beneficiary_id uuid,
  beneficiary_name text,
  academic_year text,
  class_id uuid,
  class_label text,
  period_key text,
  period_label text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_hash text NOT NULL,
  status text NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid', 'revoked', 'cancelled')),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT official_document_issues_source_version_uidx
    UNIQUE (institution_id, document_type, source_id, source_version),
  CONSTRAINT official_document_issues_number_version_uidx
    UNIQUE (institution_id, document_type, official_number, source_version)
);

CREATE INDEX IF NOT EXISTS official_document_issues_institution_type_idx
  ON public.official_document_issues (institution_id, document_type, issued_at DESC);

CREATE INDEX IF NOT EXISTS official_document_issues_beneficiary_idx
  ON public.official_document_issues (institution_id, beneficiary_id, issued_at DESC)
  WHERE beneficiary_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS official_document_issues_status_idx
  ON public.official_document_issues (institution_id, status, issued_at DESC);

CREATE TABLE IF NOT EXISTS public.official_document_print_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.official_document_issues(id) ON DELETE CASCADE,
  print_kind text NOT NULL CHECK (print_kind IN ('original', 'duplicate')),
  duplicate_number integer CHECK (
    (print_kind = 'original' AND duplicate_number IS NULL)
    OR
    (print_kind = 'duplicate' AND duplicate_number IS NOT NULL AND duplicate_number > 0)
  ),
  reason text,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS official_document_print_original_uidx
  ON public.official_document_print_events (issue_id)
  WHERE print_kind = 'original';

CREATE UNIQUE INDEX IF NOT EXISTS official_document_print_duplicate_uidx
  ON public.official_document_print_events (issue_id, duplicate_number)
  WHERE print_kind = 'duplicate';

CREATE INDEX IF NOT EXISTS official_document_print_events_issue_idx
  ON public.official_document_print_events (issue_id, generated_at DESC);

CREATE OR REPLACE FUNCTION public.set_official_document_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_official_document_issues_updated_at
  ON public.official_document_issues;
CREATE TRIGGER trg_official_document_issues_updated_at
BEFORE UPDATE ON public.official_document_issues
FOR EACH ROW
EXECUTE FUNCTION public.set_official_document_updated_at();

CREATE OR REPLACE FUNCTION public.register_official_document_print(
  p_issue_id uuid,
  p_generated_by uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
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
  v_issue public.official_document_issues%ROWTYPE;
  v_has_original boolean;
  v_duplicate_number integer;
  v_event public.official_document_print_events%ROWTYPE;
BEGIN
  SELECT *
    INTO v_issue
  FROM public.official_document_issues
  WHERE id = p_issue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'official_document_issue_not_found';
  END IF;

  IF v_issue.status <> 'valid' THEN
    RAISE EXCEPTION 'official_document_issue_not_valid';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.official_document_print_events
    WHERE issue_id = p_issue_id
      AND print_kind = 'original'
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
      p_issue_id,
      'original',
      NULL,
      NULL,
      p_generated_by,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_event;
  ELSE
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'duplicate_reason_required';
    END IF;

    SELECT COALESCE(MAX(e.duplicate_number), 0) + 1
      INTO v_duplicate_number
    FROM public.official_document_print_events e
    WHERE e.issue_id = p_issue_id
      AND e.print_kind = 'duplicate';

    INSERT INTO public.official_document_print_events (
      issue_id,
      print_kind,
      duplicate_number,
      reason,
      generated_by,
      metadata
    ) VALUES (
      p_issue_id,
      'duplicate',
      v_duplicate_number,
      btrim(p_reason),
      p_generated_by,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_event;
  END IF;

  RETURN QUERY
  SELECT v_event.id, v_event.print_kind, v_event.duplicate_number, v_event.generated_at;
END;
$$;

-- Enregistrement atomique d'une impression de classe. Toute la série de
-- bulletins est validée et enregistrée dans une seule transaction : une erreur
-- sur un élève ne peut donc pas transformer une demi-classe en duplicata.
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

    -- Sérialise deux émissions concurrentes du même bulletin, même avant la
    -- création de la première ligne du registre.
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
      IF v_issue.status <> 'valid' THEN
        RAISE EXCEPTION 'official_bulletin_not_valid:%', v_source_id;
      END IF;
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

    IF v_has_original AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'duplicate_reason_required';
    END IF;

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
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source_id', v_source_id)
      )
      RETURNING * INTO v_event;
    ELSE
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
        btrim(p_reason),
        p_generated_by,
        COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source_id', v_source_id)
      )
      RETURNING * INTO v_event;
    END IF;

    -- Un code court enregistré en base devient immuable avec le bulletin.
    -- Les QR de secours signés (sans qr_code) sont déjà immuables par nature.
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

-- Le QR d'un bulletin officiellement émis devient immuable. Le bloc reste
-- compatible avec une ancienne installation qui n'aurait pas encore la table.
DO $$
BEGIN
  IF to_regclass('public.bulletin_qr_codes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.bulletin_qr_codes
      ADD COLUMN IF NOT EXISTS payload_hash text';
    EXECUTE 'ALTER TABLE public.bulletin_qr_codes
      ADD COLUMN IF NOT EXISTS official_issue_id uuid
      REFERENCES public.official_document_issues(id) ON DELETE SET NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS bulletin_qr_codes_official_issue_idx
      ON public.bulletin_qr_codes (official_issue_id)
      WHERE official_issue_id IS NOT NULL';
  END IF;
END;
$$;

ALTER TABLE public.official_document_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_document_print_events ENABLE ROW LEVEL SECURITY;

-- Les opérations passent exclusivement par les routes serveur utilisant service_role.
REVOKE ALL ON public.official_document_issues FROM anon, authenticated;
REVOKE ALL ON public.official_document_print_events FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.register_official_document_print(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_official_bulletin_batch(uuid, jsonb, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.official_document_issues TO service_role;
GRANT ALL ON public.official_document_print_events TO service_role;
GRANT EXECUTE ON FUNCTION public.register_official_document_print(uuid, uuid, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.register_official_bulletin_batch(uuid, jsonb, uuid, text, jsonb)
  TO service_role;

COMMIT;
