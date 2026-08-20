-- CSCA 2026-2027 — trace idempotente des subdivisions créées en production.
-- Cette migration ne touche ni aux élèves ni au schéma Finance.

DO $$
DECLARE
  v_institution_id uuid;
  v_inserted integer := 0;
BEGIN
  SELECT id
    INTO v_institution_id
  FROM public.institutions
  WHERE code = '000657'
  LIMIT 1;

  IF v_institution_id IS NULL THEN
    RAISE EXCEPTION 'CSCA introuvable (code 000657).';
  END IF;

  INSERT INTO public.classes (
    institution_id,
    code,
    label,
    level,
    academic_year,
    official_track_code,
    education_type,
    formation_level_code
  )
  VALUES
    (v_institution_id, '4e2', '4e2', '4e', '2026-2027', '4eme', 'general_secondary', '4eme'),
    (v_institution_id, '4e3', '4e3', '4e', '2026-2027', '4eme', 'general_secondary', '4eme'),
    (v_institution_id, 'ta2', 'TA2', 'TA', '2026-2027', 'tleA2', 'general_secondary', 'tleA2'),
    (v_institution_id, 'td2', 'TD2', 'TD', '2026-2027', 'tleD', 'general_secondary', 'tleD')
  ON CONFLICT (institution_id, academic_year, code) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF (
    SELECT count(*)
    FROM public.classes
    WHERE institution_id = v_institution_id
      AND academic_year = '2026-2027'
      AND code IN ('4e2', '4e3', 'ta2', 'td2')
  ) <> 4 THEN
    RAISE EXCEPTION 'Les quatre classes CSCA attendues ne sont pas présentes.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.classes
    WHERE institution_id = v_institution_id
      AND academic_year = '2026-2027'
      AND (
        (code = '4e2' AND (label, level, official_track_code, education_type, formation_level_code)
          IS DISTINCT FROM ('4e2', '4e', '4eme', 'general_secondary', '4eme'))
        OR
        (code = '4e3' AND (label, level, official_track_code, education_type, formation_level_code)
          IS DISTINCT FROM ('4e3', '4e', '4eme', 'general_secondary', '4eme'))
        OR
        (code = 'ta2' AND (label, level, official_track_code, education_type, formation_level_code)
          IS DISTINCT FROM ('TA2', 'TA', 'tleA2', 'general_secondary', 'tleA2'))
        OR
        (code = 'td2' AND (label, level, official_track_code, education_type, formation_level_code)
          IS DISTINCT FROM ('TD2', 'TD', 'tleD', 'general_secondary', 'tleD'))
      )
  ) THEN
    RAISE EXCEPTION 'Une classe CSCA existe avec des métadonnées inattendues.';
  END IF;

  IF v_inserted > 0
     AND to_regprocedure('public.bump_relay_academic_revision(uuid)') IS NOT NULL THEN
    PERFORM public.bump_relay_academic_revision(v_institution_id);
  END IF;
END
$$;
