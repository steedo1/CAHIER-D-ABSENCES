-- ============================================================
-- DIAGNOSTIC FINANCE CSCA 2026-2027 APRÈS ANOMALIES
-- Ne modifie rien.
-- Objectif : identifier si les anomalies viennent de doublons,
-- de dettes incompatibles avec le profil élève, ou de dettes
-- créées automatiquement depuis l'écran Encaissements.
-- ============================================================

-- 1) Totaux réels en base
SELECT
  COUNT(DISTINCT sc.student_id) AS eleves_factures,
  COUNT(*) AS lignes_dettes,
  SUM(sc.base_amount) AS total_facture
FROM finance.student_charges sc
WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND sc.academic_year = '2026-2027'
  AND COALESCE(sc.status::text, '') <> 'cancelled';

-- 2) Origine probable des dettes : notes / dates / créateurs
SELECT
  COALESCE(NULLIF(TRIM(sc.notes), ''), '(sans note)') AS notes,
  sc.created_by,
  sc.created_at::date AS date_creation,
  COUNT(*) AS lignes,
  SUM(sc.base_amount) AS total
FROM finance.student_charges sc
WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND sc.academic_year = '2026-2027'
  AND COALESCE(sc.status::text, '') <> 'cancelled'
GROUP BY COALESCE(NULLIF(TRIM(sc.notes), ''), '(sans note)'), sc.created_by, sc.created_at::date
ORDER BY date_creation DESC, lignes DESC;

-- 3) Doublons exacts : même élève + même barème
SELECT
  c.label AS classe,
  s.full_name,
  sc.fee_schedule_id,
  sc.label,
  COUNT(*) AS doublons,
  SUM(sc.base_amount) AS total
FROM finance.student_charges sc
JOIN public.students s
  ON s.id = sc.student_id
 AND s.institution_id = sc.school_id
LEFT JOIN public.classes c
  ON c.id = sc.class_id
 AND c.institution_id = sc.school_id
WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND sc.academic_year = '2026-2027'
  AND COALESCE(sc.status::text, '') <> 'cancelled'
  AND sc.fee_schedule_id IS NOT NULL
GROUP BY c.label, s.full_name, sc.fee_schedule_id, sc.label
HAVING COUNT(*) > 1
ORDER BY doublons DESC, c.label, s.full_name
LIMIT 100;

-- 4) Dettes incompatibles avec le profil de l'élève
-- Exemples recherchés :
-- - Pension / Internat sur élève externe
-- - Écolage affecté sur non affecté
-- - Écolage non affecté sur affecté
WITH active_students AS (
  SELECT
    c.id AS active_class_id,
    c.label AS active_class,
    s.id AS student_id,
    s.full_name,
    s.is_affecte,
    s.is_boarder
  FROM public.classes c
  JOIN public.class_enrollments ce
    ON ce.class_id = c.id
   AND ce.institution_id = c.institution_id
   AND ce.end_date IS NULL
  JOIN public.students s
    ON s.id = ce.student_id
   AND s.institution_id = c.institution_id
  WHERE c.institution_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    AND c.academic_year = '2026-2027'
)
SELECT
  a.active_class,
  s.full_name,
  s.is_affecte,
  s.is_boarder,
  sc.label,
  COUNT(*) AS lignes,
  SUM(sc.base_amount) AS total
FROM finance.student_charges sc
JOIN public.students s
  ON s.id = sc.student_id
 AND s.institution_id = sc.school_id
LEFT JOIN active_students a
  ON a.student_id = sc.student_id
WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND sc.academic_year = '2026-2027'
  AND COALESCE(sc.status::text, '') <> 'cancelled'
  AND (
    (sc.label IN ('Internat - Pension', 'Internat - Frais annexes internat') AND COALESCE(s.is_boarder, false) IS NOT TRUE)
    OR (sc.label = 'Scolarité - Écolage affecté' AND COALESCE(s.is_affecte, false) IS NOT TRUE)
    OR (sc.label = 'Scolarité - Écolage non affecté' AND s.is_affecte IS TRUE)
  )
GROUP BY a.active_class, s.full_name, s.is_affecte, s.is_boarder, sc.label
ORDER BY a.active_class, s.full_name, sc.label
LIMIT 200;

-- 5) Dettes dont la classe ne correspond pas à l'inscription active 2026-2027
WITH active_students AS (
  SELECT
    c.id AS active_class_id,
    c.label AS active_class,
    s.id AS student_id,
    s.full_name
  FROM public.classes c
  JOIN public.class_enrollments ce
    ON ce.class_id = c.id
   AND ce.institution_id = c.institution_id
   AND ce.end_date IS NULL
  JOIN public.students s
    ON s.id = ce.student_id
   AND s.institution_id = c.institution_id
  WHERE c.institution_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    AND c.academic_year = '2026-2027'
)
SELECT
  a.active_class AS classe_active,
  oldc.label AS classe_dette,
  a.full_name,
  sc.label,
  COUNT(*) AS lignes,
  SUM(sc.base_amount) AS total
FROM finance.student_charges sc
JOIN active_students a
  ON a.student_id = sc.student_id
LEFT JOIN public.classes oldc
  ON oldc.id = sc.class_id
 AND oldc.institution_id = sc.school_id
WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND sc.academic_year = '2026-2027'
  AND COALESCE(sc.status::text, '') <> 'cancelled'
  AND sc.class_id IS DISTINCT FROM a.active_class_id
GROUP BY a.active_class, oldc.label, a.full_name, sc.label
ORDER BY a.active_class, a.full_name, sc.label
LIMIT 200;

-- 6) Dettes supplémentaires sans reçu lié.
-- Ce sont les seules candidates à une annulation automatique.
WITH alloc AS (
  SELECT DISTINCT ra.student_charge_id
  FROM finance.receipt_allocations ra
)
SELECT
  sc.label,
  COUNT(*) AS lignes_sans_recu,
  SUM(sc.base_amount) AS total_sans_recu
FROM finance.student_charges sc
LEFT JOIN alloc a
  ON a.student_charge_id = sc.id
WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND sc.academic_year = '2026-2027'
  AND COALESCE(sc.status::text, '') <> 'cancelled'
  AND a.student_charge_id IS NULL
GROUP BY sc.label
ORDER BY sc.label;
