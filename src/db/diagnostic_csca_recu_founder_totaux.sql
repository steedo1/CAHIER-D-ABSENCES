-- ============================================================
-- DIAGNOSTIC CSCA — reçus / dashboard fondateur
-- Ne modifie rien.
-- Objectif :
-- 1) retrouver les encaissements encore actifs par année ;
-- 2) vérifier si le 200 000 F vient d'un reçu 2025-2026 ;
-- 3) vérifier les dettes scolarité réelles d'un reçu.
-- ============================================================

-- A) Reçus actifs CSCA par année scolaire
SELECT
  COALESCE(r.academic_year, '(sans année)') AS academic_year,
  COUNT(*) AS recus_actifs,
  COALESCE(SUM(r.total_amount), 0) AS total_actif
FROM finance.receipts r
WHERE r.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
GROUP BY COALESCE(r.academic_year, '(sans année)')
ORDER BY academic_year;

-- B) Tous les reçus actifs de 200 000 F encore présents
SELECT
  r.id,
  r.receipt_no,
  r.receipt_status,
  r.total_amount,
  r.academic_year,
  r.payment_date,
  r.created_at,
  r.reference_no,
  s.full_name AS eleve
FROM finance.receipts r
LEFT JOIN public.students s
  ON s.id = r.student_id
 AND s.institution_id = r.school_id
WHERE r.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
  AND r.total_amount = 200000
ORDER BY r.created_at DESC;

-- C) Vérifier si des reçus hors année courante ont été comptés "aujourd'hui"
-- Remplace la date si besoin.
SELECT
  r.academic_year,
  r.receipt_no,
  r.total_amount,
  r.payment_date,
  r.created_at,
  s.full_name AS eleve
FROM finance.receipts r
LEFT JOIN public.students s
  ON s.id = r.student_id
 AND s.institution_id = r.school_id
WHERE r.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
  AND r.payment_date >= TIMESTAMPTZ '2026-05-25 00:00:00+00'
  AND r.payment_date <  TIMESTAMPTZ '2026-05-26 00:00:00+00'
ORDER BY r.academic_year, r.payment_date, r.created_at;

-- D) Totaux dettes/encaissements 2026-2027 stricts
WITH dettes AS (
  SELECT COALESCE(SUM(sc.base_amount), 0) AS total_facture
  FROM finance.student_charges sc
  WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    AND sc.academic_year = '2026-2027'
    AND COALESCE(sc.status::text, '') <> 'cancelled'
),
recus AS (
  SELECT COALESCE(SUM(r.total_amount), 0) AS total_encaisse
  FROM finance.receipts r
  WHERE r.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    AND r.academic_year = '2026-2027'
    AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
)
SELECT
  d.total_facture,
  r.total_encaisse,
  d.total_facture - r.total_encaisse AS reste_a_recouvrer
FROM dettes d
CROSS JOIN recus r;
