-- ============================================================
-- DIAGNOSTIC CSCA — synchronisation statut élève <-> dettes finance
-- Ne modifie aucune donnée.
--
-- À modifier avant exécution si besoin : p_student_search.
-- Exemple : 'KOUADIO ANGE' ou le matricule exact.
-- ============================================================

WITH params AS (
  SELECT
    '000657'::text AS p_school_code_unique,
    'KOUADIO ANGE'::text AS p_student_search,
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
    TRIM(CONCAT_WS(' ', s.last_name, s.first_name)) AS eleve,
    s.full_name,
    s.is_affecte,
    s.is_boarder,
    ce.class_id,
    c.label AS classe,
    c.academic_year
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
), fee_categories AS (
  SELECT fc.*
  FROM finance.fee_categories fc
  JOIN target_school ts ON ts.id = fc.school_id
), schedules AS (
  SELECT
    fs.id AS fee_schedule_id,
    fs.class_id,
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
        THEN 'scolarite'
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%renforcement%'
        THEN 'cours_renforcement'
      ELSE 'custom'
    END AS detected_kind
  FROM finance.fee_schedules fs
  JOIN target_school ts ON ts.id = fs.school_id
  LEFT JOIN fee_categories fc ON fc.id = fs.fee_category_id
), matching_schedules AS (
  SELECT
    ts.student_id,
    ts.eleve,
    ts.matricule,
    ts.classe,
    ts.academic_year AS classe_annee,
    ts.is_affecte,
    ts.is_boarder,
    s.*,
    CASE
      WHEN s.detected_kind = 'internat' THEN ts.is_boarder IS TRUE
      WHEN s.detected_kind = 'scolarite'
        AND LOWER(COALESCE(s.label, '')) LIKE '%non affect%' THEN ts.is_affecte IS FALSE
      WHEN s.detected_kind = 'scolarite'
        AND LOWER(COALESCE(s.label, '')) LIKE '%ecolage%'
        AND LOWER(COALESCE(s.label, '')) LIKE '%affect%' THEN ts.is_affecte IS TRUE
      WHEN s.detected_kind = 'scolarite' THEN TRUE
      ELSE TRUE
    END AS should_apply
  FROM target_student ts
  JOIN schedules s
    ON s.is_active IS TRUE
   AND (s.class_id IS NULL OR s.class_id = ts.class_id)
   AND (s.academic_year IS NULL OR s.academic_year = ts.academic_year)
), existing_charges AS (
  SELECT
    ts.student_id,
    sc.id AS charge_id,
    sc.fee_schedule_id,
    sc.label,
    sc.base_amount,
    COALESCE(vb.paid_amount, 0) AS paid_amount,
    COALESCE(vb.balance_due, sc.base_amount) AS balance_due,
    COALESCE(vb.computed_status::text, sc.status::text) AS computed_status,
    sc.created_at,
    sc.updated_at
  FROM target_student ts
  LEFT JOIN finance.student_charges sc
    ON sc.school_id = (SELECT id FROM target_school)
   AND sc.student_id = ts.student_id
   AND sc.class_id = ts.class_id
  LEFT JOIN finance.v_charge_balances vb
    ON vb.id = sc.id
   AND vb.school_id = sc.school_id
), missing AS (
  SELECT ms.*
  FROM matching_schedules ms
  LEFT JOIN existing_charges ec
    ON ec.fee_schedule_id = ms.fee_schedule_id
   AND ec.computed_status <> 'cancelled'
  WHERE ms.should_apply IS TRUE
    AND ec.charge_id IS NULL
)
SELECT
  '01_ELEVE_CIBLE' AS bloc,
  student_id,
  matricule,
  eleve,
  classe,
  classe_annee,
  CASE WHEN is_affecte IS TRUE THEN 'AFFECTE' WHEN is_affecte IS FALSE THEN 'NON AFFECTE' ELSE 'NON RENSEIGNE' END AS affectation,
  CASE WHEN is_boarder IS TRUE THEN 'INTERNE' WHEN is_boarder IS FALSE THEN 'EXTERNE' ELSE 'NON RENSEIGNE' END AS internat,
  NULL::text AS category_code,
  NULL::text AS label,
  NULL::numeric AS amount,
  NULL::text AS status
FROM target_student

UNION ALL

SELECT
  '02_BAREMES_ACTIFS_COMPATIBLES_CLASSE_ANNEE' AS bloc,
  student_id,
  matricule,
  eleve,
  classe,
  classe_annee,
  detected_kind AS affectation,
  CASE WHEN should_apply THEN 'APPLICABLE' ELSE 'NON APPLICABLE' END AS internat,
  category_code,
  label,
  amount,
  NULL::text AS status
FROM matching_schedules

UNION ALL

SELECT
  '03_DETTES_EXISTANTES' AS bloc,
  ts.student_id,
  ts.matricule,
  ts.eleve,
  ts.classe,
  ts.academic_year,
  NULL::text,
  NULL::text,
  NULL::text,
  ec.label,
  ec.base_amount,
  ec.computed_status
FROM target_student ts
JOIN existing_charges ec ON ec.student_id = ts.student_id
WHERE ec.charge_id IS NOT NULL

UNION ALL

SELECT
  '04_DETTES_APPLICABLES_MANQUANTES' AS bloc,
  student_id,
  matricule,
  eleve,
  classe,
  classe_annee,
  detected_kind,
  'MANQUANTE',
  category_code,
  label,
  amount,
  NULL::text
FROM missing
ORDER BY bloc, label;

-- Résumé lisible : si scolarite = 0 ou internat = 0 alors que l'élève est INTERNE,
-- le problème vient des barèmes actifs/rattachés, pas de l'encaissement.
WITH params AS (
  SELECT '000657'::text AS p_school_code_unique, 'KOUADIO ANGE'::text AS p_student_search, NULL::uuid AS p_student_id
), target_school AS (
  SELECT i.id
  FROM public.institutions i JOIN params p ON true
  WHERE COALESCE(i.code_unique, '') = p.p_school_code_unique
     OR UPPER(COALESCE(i.name, '')) LIKE '%COURS SECONDAIRE CATHOLIQUE%ABOISSO%'
  LIMIT 1
), target_student AS (
  SELECT DISTINCT s.id AS student_id, s.is_affecte, s.is_boarder, ce.class_id, c.academic_year
  FROM target_school ts
  JOIN public.students s ON s.institution_id = ts.id
  JOIN public.class_enrollments ce ON ce.student_id = s.id AND ce.institution_id = ts.id AND ce.end_date IS NULL
  JOIN public.classes c ON c.id = ce.class_id AND c.institution_id = ts.id
  JOIN params p ON true
  WHERE (p.p_student_id IS NOT NULL AND s.id = p.p_student_id)
     OR (p.p_student_id IS NULL AND (
       UPPER(COALESCE(s.matricule, '')) = UPPER(p.p_student_search)
       OR UPPER(TRIM(CONCAT_WS(' ', s.last_name, s.first_name))) LIKE '%' || UPPER(p.p_student_search) || '%'
       OR UPPER(COALESCE(s.full_name, '')) LIKE '%' || UPPER(p.p_student_search) || '%'
     ))
), matching AS (
  SELECT
    CASE
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%internat%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%pension%' THEN 'internat'
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%scolar%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%ecolage%'
        OR LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%inscription%' THEN 'scolarite'
      WHEN LOWER(COALESCE(fc.code, '') || ' ' || COALESCE(fc.name, '') || ' ' || COALESCE(fs.label, '')) LIKE '%renforcement%' THEN 'cours_renforcement'
      ELSE 'custom'
    END AS kind,
    fs.id
  FROM target_student st
  JOIN finance.fee_schedules fs
    ON fs.school_id = (SELECT id FROM target_school)
   AND fs.is_active IS TRUE
   AND (fs.class_id IS NULL OR fs.class_id = st.class_id)
   AND (fs.academic_year IS NULL OR fs.academic_year = st.academic_year)
  LEFT JOIN finance.fee_categories fc ON fc.id = fs.fee_category_id
)
SELECT
  COUNT(*) FILTER (WHERE kind = 'scolarite') AS baremes_scolarite_actifs,
  COUNT(*) FILTER (WHERE kind = 'internat') AS baremes_internat_actifs,
  COUNT(*) FILTER (WHERE kind = 'cours_renforcement') AS baremes_renforcement_actifs,
  COUNT(*) FILTER (WHERE kind = 'custom') AS baremes_autres_actifs
FROM matching;
