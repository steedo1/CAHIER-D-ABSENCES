-- ============================================================
-- DIAGNOSTIC CSCA — barèmes réellement utilisables après correction v6
-- Ne modifie aucune donnée.
-- Objectif : montrer si les barèmes viennent de la classe exacte,
-- d'un barème global, d'une classe de même libellé/code ou d'une
-- ancienne classe du même niveau.
-- ============================================================

WITH params AS (
  SELECT
    '000657'::text AS p_school_code_unique,
    'KOUADIO ANGE TEST'::text AS p_student_search,
    NULL::uuid AS p_student_id
), target_school AS (
  SELECT i.id, i.name, i.code_unique
  FROM public.institutions i
  JOIN params p ON true
  WHERE COALESCE(i.code_unique, '') = p.p_school_code_unique
     OR UPPER(COALESCE(i.name, '')) LIKE '%COURS SECONDAIRE CATHOLIQUE%ABOISSO%'
  ORDER BY CASE WHEN COALESCE(i.code_unique, '') = p.p_school_code_unique THEN 0 ELSE 1 END
  LIMIT 1
), target_student AS (
  SELECT DISTINCT
    s.id AS student_id,
    s.matricule,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', s.last_name, s.first_name)), ''), s.full_name) AS eleve,
    s.is_affecte,
    s.is_boarder,
    ce.class_id,
    c.label AS classe,
    c.code AS classe_code,
    c.level AS classe_level,
    c.official_track_code AS classe_track,
    c.academic_year AS classe_annee
  FROM target_school ts
  JOIN public.students s ON s.institution_id = ts.id
  JOIN public.class_enrollments ce
    ON ce.student_id = s.id
   AND ce.institution_id = ts.id
   AND ce.end_date IS NULL
  JOIN public.classes c
    ON c.id = ce.class_id
   AND c.institution_id = ts.id
  JOIN params p ON true
  WHERE (
      p.p_student_id IS NOT NULL AND s.id = p.p_student_id
    )
    OR (
      p.p_student_id IS NULL
      AND (
        UPPER(COALESCE(s.matricule, '')) = UPPER(p.p_student_search)
        OR UPPER(TRIM(CONCAT_WS(' ', s.last_name, s.first_name))) LIKE '%' || UPPER(p.p_student_search) || '%'
        OR UPPER(TRIM(CONCAT_WS(' ', s.first_name, s.last_name))) LIKE '%' || UPPER(p.p_student_search) || '%'
        OR UPPER(COALESCE(s.full_name, '')) LIKE '%' || UPPER(p.p_student_search) || '%'
      )
    )
), schedules AS (
  SELECT
    fs.id AS fee_schedule_id,
    fs.class_id AS schedule_class_id,
    sc.label AS schedule_class_label,
    sc.code AS schedule_class_code,
    sc.level AS schedule_class_level,
    sc.official_track_code AS schedule_class_track,
    fs.academic_year,
    fs.label,
    fs.amount,
    fs.due_date,
    fs.is_active,
    fc.code AS category_code,
    fc.name AS category_name,
    CASE
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%internat%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%pension%'
        THEN 'internat'
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%scolar%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%ecolage%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%inscription%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%frais generaux%'
        THEN 'scolarite'
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%renforcement%'
        THEN 'cours_renforcement'
      ELSE 'custom'
    END AS detected_kind
  FROM target_school ts
  JOIN finance.fee_schedules fs
    ON fs.school_id = ts.id
   AND fs.is_active IS TRUE
  LEFT JOIN finance.fee_categories fc
    ON fc.id = fs.fee_category_id
   AND fc.school_id = fs.school_id
  LEFT JOIN public.classes sc
    ON sc.id = fs.class_id
   AND sc.institution_id = fs.school_id
), matched AS (
  SELECT
    ts.*,
    s.*,
    CASE
      WHEN s.schedule_class_id IS NULL THEN 'GLOBAL'
      WHEN s.schedule_class_id = ts.class_id THEN 'CLASSE_EXACTE'
      WHEN LOWER(COALESCE(s.schedule_class_label, '')) = LOWER(COALESCE(ts.classe, ''))
        OR LOWER(COALESCE(s.schedule_class_code, '')) = LOWER(COALESCE(ts.classe_code, '')) THEN 'MEME_LIBELLE_OU_CODE'
      WHEN LOWER(COALESCE(s.schedule_class_level, '')) = LOWER(COALESCE(ts.classe_level, ''))
        OR LOWER(COALESCE(s.schedule_class_track, '')) = LOWER(COALESCE(ts.classe_track, '')) THEN 'MEME_NIVEAU_FILET_SECURITE'
      ELSE 'NON_COMPATIBLE'
    END AS match_mode,
    CASE
      WHEN s.detected_kind = 'internat' THEN ts.is_boarder IS TRUE
      WHEN s.detected_kind = 'scolarite' AND LOWER(COALESCE(s.label, '')) LIKE '%non affect%' THEN ts.is_affecte IS FALSE
      WHEN s.detected_kind = 'scolarite' AND LOWER(COALESCE(s.label, '')) LIKE '%ecolage%' AND LOWER(COALESCE(s.label, '')) LIKE '%affect%' THEN ts.is_affecte IS TRUE
      ELSE TRUE
    END AS should_apply
  FROM target_student ts
  JOIN schedules s
    ON (s.academic_year IS NULL OR s.academic_year = ts.classe_annee)
)
SELECT
  '01_ELEVE' AS bloc,
  eleve,
  classe,
  classe_level,
  classe_annee,
  CASE WHEN is_affecte THEN 'AFFECTE' ELSE 'NON_AFFECTE' END AS affectation,
  CASE WHEN is_boarder THEN 'INTERNE' ELSE 'EXTERNE' END AS internat,
  NULL::text AS match_mode,
  NULL::text AS category_code,
  NULL::text AS detected_kind,
  NULL::text AS label,
  NULL::numeric AS amount
FROM target_student

UNION ALL

SELECT
  '02_BAREMES_COMPATIBLES' AS bloc,
  eleve,
  classe,
  classe_level,
  classe_annee,
  CASE WHEN is_affecte THEN 'AFFECTE' ELSE 'NON_AFFECTE' END,
  CASE WHEN is_boarder THEN 'INTERNE' ELSE 'EXTERNE' END,
  match_mode,
  category_code,
  detected_kind,
  label,
  amount
FROM matched
WHERE match_mode <> 'NON_COMPATIBLE'
  AND should_apply IS TRUE
ORDER BY bloc, detected_kind, label;

WITH params AS (
  SELECT '000657'::text AS p_school_code_unique, 'KOUADIO ANGE TEST'::text AS p_student_search, NULL::uuid AS p_student_id
), target_school AS (
  SELECT i.id FROM public.institutions i JOIN params p ON true
  WHERE COALESCE(i.code_unique, '') = p.p_school_code_unique
     OR UPPER(COALESCE(i.name, '')) LIKE '%COURS SECONDAIRE CATHOLIQUE%ABOISSO%'
  LIMIT 1
), target_student AS (
  SELECT DISTINCT s.id AS student_id, s.is_affecte, s.is_boarder, ce.class_id, c.label, c.code, c.level, c.official_track_code, c.academic_year
  FROM target_school ts
  JOIN public.students s ON s.institution_id = ts.id
  JOIN public.class_enrollments ce ON ce.student_id = s.id AND ce.institution_id = ts.id AND ce.end_date IS NULL
  JOIN public.classes c ON c.id = ce.class_id AND c.institution_id = ts.id
  JOIN params p ON true
  WHERE p.p_student_id IS NOT NULL AND s.id = p.p_student_id
     OR p.p_student_id IS NULL AND (
       UPPER(COALESCE(s.matricule, '')) = UPPER(p.p_student_search)
       OR UPPER(TRIM(CONCAT_WS(' ', s.last_name, s.first_name))) LIKE '%' || UPPER(p.p_student_search) || '%'
       OR UPPER(COALESCE(s.full_name, '')) LIKE '%' || UPPER(p.p_student_search) || '%'
     )
), matched AS (
  SELECT
    CASE
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%internat%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%pension%' THEN 'internat'
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%scolar%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%ecolage%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%inscription%' THEN 'scolarite'
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%renforcement%' THEN 'cours_renforcement'
      ELSE 'custom'
    END AS detected_kind,
    CASE
      WHEN fs.class_id IS NULL THEN 'GLOBAL'
      WHEN fs.class_id = ts.class_id THEN 'CLASSE_EXACTE'
      WHEN LOWER(COALESCE(c.label, '')) = LOWER(COALESCE(ts.label, '')) OR LOWER(COALESCE(c.code, '')) = LOWER(COALESCE(ts.code, '')) THEN 'MEME_LIBELLE_OU_CODE'
      WHEN LOWER(COALESCE(c.level, '')) = LOWER(COALESCE(ts.level, '')) OR LOWER(COALESCE(c.official_track_code, '')) = LOWER(COALESCE(ts.official_track_code, '')) THEN 'MEME_NIVEAU_FILET_SECURITE'
      ELSE 'NON_COMPATIBLE'
    END AS match_mode
  FROM target_student ts
  JOIN finance.fee_schedules fs ON fs.school_id = (SELECT id FROM target_school) AND fs.is_active IS TRUE
  LEFT JOIN finance.fee_categories fc ON fc.id = fs.fee_category_id AND fc.school_id = fs.school_id
  LEFT JOIN public.classes c ON c.id = fs.class_id AND c.institution_id = fs.school_id
  WHERE (fs.academic_year IS NULL OR fs.academic_year = ts.academic_year)
)
SELECT
  match_mode,
  COUNT(*) FILTER (WHERE detected_kind = 'scolarite') AS scolarite,
  COUNT(*) FILTER (WHERE detected_kind = 'internat') AS internat,
  COUNT(*) FILTER (WHERE detected_kind = 'cours_renforcement') AS renforcement,
  COUNT(*) FILTER (WHERE detected_kind = 'custom') AS autres
FROM matched
WHERE match_mode <> 'NON_COMPATIBLE'
GROUP BY match_mode
ORDER BY match_mode;
