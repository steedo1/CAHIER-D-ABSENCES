-- CSCA 2026-2027 — trace idempotente des 11 affectations sûres appliquées en production.
-- Règle de sécurité : aucune écriture dans finance.*.
-- Si un élève est déjà actif dans une autre classe, ou s'il faut créer son inscription
-- alors que des données Finance existent déjà, la migration s'arrête au lieu de deviner.

DO $$
DECLARE
  v_institution_id uuid;
  v_academic_year_id uuid;
  v_start_date date;
  v_student_id uuid;
  v_target_class_id uuid;
  v_active_class_id uuid;
  v_profile_class_id uuid;
  v_class_level text;
  v_track_code text;
  v_student_boarder boolean;
  v_match_count integer;
  v_inserted integer := 0;
  r record;
BEGIN
  SELECT id
    INTO v_institution_id
  FROM public.institutions
  WHERE code = '000657'
  LIMIT 1;

  IF v_institution_id IS NULL THEN
    RAISE EXCEPTION 'CSCA introuvable (code 000657).';
  END IF;

  SELECT id, start_date
    INTO v_academic_year_id, v_start_date
  FROM public.academic_years
  WHERE institution_id = v_institution_id
    AND code = '2026-2027'
  LIMIT 1;

  IF v_academic_year_id IS NULL OR v_start_date IS NULL THEN
    RAISE EXCEPTION 'Année scolaire CSCA 2026-2027 introuvable ou incomplète.';
  END IF;

  FOR r IN
    SELECT *
    FROM (VALUES
      ('24267414W', '5e1'),
      ('25028771C', '5e1'),
      ('25281579U', '5e2'),
      ('24518221L', '4e2'),
      ('22434825Y', '4e3'),
      ('20304738R', '1d1'),
      ('20079622L', 'td1'),
      ('20564392G', 'td1'),
      ('20676588D', 'td1'),
      ('20166776P', 'td2'),
      ('20610625C', 'ta2')
    ) AS target(matricule_key, class_code)
  LOOP
    v_student_id := NULL;
    v_target_class_id := NULL;
    v_active_class_id := NULL;
    v_profile_class_id := NULL;
    v_class_level := NULL;
    v_track_code := NULL;
    v_student_boarder := false;

    SELECT count(*), (array_agg(s.id ORDER BY s.id::text))[1]
      INTO v_match_count, v_student_id
    FROM public.students s
    WHERE s.institution_id = v_institution_id
      AND regexp_replace(upper(coalesce(s.matricule, '')), '[^A-Z0-9]', '', 'g') = r.matricule_key;

    IF v_match_count <> 1 OR v_student_id IS NULL THEN
      RAISE EXCEPTION 'Matricule % : % fiche(s) élève trouvée(s), exactement 1 attendue.',
        r.matricule_key, v_match_count;
    END IF;

    SELECT coalesce(s.is_boarder, false)
      INTO v_student_boarder
    FROM public.students s
    WHERE s.id = v_student_id
      AND s.institution_id = v_institution_id;

    SELECT c.id, c.level, c.official_track_code
      INTO v_target_class_id, v_class_level, v_track_code
    FROM public.classes c
    WHERE c.institution_id = v_institution_id
      AND c.academic_year = '2026-2027'
      AND c.code = r.class_code
    LIMIT 1;

    IF v_target_class_id IS NULL OR v_class_level IS NULL THEN
      RAISE EXCEPTION 'Classe cible % introuvable pour le matricule %.',
        r.class_code, r.matricule_key;
    END IF;

    SELECT ce.class_id
      INTO v_active_class_id
    FROM public.class_enrollments ce
    WHERE ce.institution_id = v_institution_id
      AND ce.student_id = v_student_id
      AND ce.end_date IS NULL
    LIMIT 1;

    IF v_active_class_id IS NOT NULL AND v_active_class_id <> v_target_class_id THEN
      RAISE EXCEPTION 'Matricule % déjà actif dans une autre classe : aucune réaffectation automatique.',
        r.matricule_key;
    END IF;

    IF v_active_class_id IS NULL THEN
      IF EXISTS (
        SELECT 1
        FROM finance.student_charges sc
        WHERE sc.school_id = v_institution_id
          AND sc.student_id = v_student_id
          AND (sc.academic_year_id = v_academic_year_id OR sc.academic_year = '2026-2027')
      ) OR EXISTS (
        SELECT 1
        FROM finance.receipts fr
        WHERE fr.school_id = v_institution_id
          AND fr.student_id = v_student_id
          AND (fr.academic_year_id = v_academic_year_id OR fr.academic_year = '2026-2027')
      ) THEN
        RAISE EXCEPTION 'Matricule % : Finance déjà présente, inscription automatique bloquée.',
          r.matricule_key;
      END IF;

      INSERT INTO public.class_enrollments (
        institution_id,
        student_id,
        class_id,
        start_date,
        end_date,
        official_track_code
      )
      VALUES (
        v_institution_id,
        v_student_id,
        v_target_class_id,
        v_start_date,
        NULL,
        v_track_code
      );

      v_inserted := v_inserted + 1;
    END IF;

    SELECT syp.class_id
      INTO v_profile_class_id
    FROM public.student_year_profiles syp
    WHERE syp.institution_id = v_institution_id
      AND syp.academic_year_id = v_academic_year_id
      AND syp.student_id = v_student_id
    LIMIT 1;

    IF v_profile_class_id IS NOT NULL AND v_profile_class_id <> v_target_class_id THEN
      RAISE EXCEPTION 'Matricule % : profil annuel déjà lié à une autre classe.',
        r.matricule_key;
    END IF;

    IF v_profile_class_id IS NULL THEN
      INSERT INTO public.student_year_profiles (
        institution_id,
        academic_year_id,
        academic_year,
        student_id,
        class_id,
        level,
        is_boarder,
        affectation_status,
        billing_affectation_group,
        scholarship_status,
        source
      )
      VALUES (
        v_institution_id,
        v_academic_year_id,
        '2026-2027',
        v_student_id,
        v_target_class_id,
        v_class_level,
        v_student_boarder,
        'unknown',
        'unknown',
        'unknown',
        'csca_workbook_20260820'
      )
      ON CONFLICT (institution_id, academic_year_id, student_id) DO NOTHING;
    END IF;
  END LOOP;

  IF v_inserted > 0
     AND to_regprocedure('public.bump_relay_academic_revision(uuid)') IS NOT NULL THEN
    PERFORM public.bump_relay_academic_revision(v_institution_id);
  END IF;
END
$$;
