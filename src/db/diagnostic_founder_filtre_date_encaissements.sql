-- DIAGNOSTIC FOUNDER — FILTRE DATE ENCAISSEMENTS
-- Ne modifie rien. Ajuster les bornes si besoin.

WITH params AS (
  SELECT
    'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id,
    TIMESTAMPTZ '2026-05-25 00:00:00+00' AS start_at,
    TIMESTAMPTZ '2026-05-26 00:00:00+00' AS end_at
)
SELECT
  r.academic_year,
  COUNT(*) AS recus,
  COALESCE(SUM(r.total_amount), 0) AS total
FROM finance.receipts r
JOIN params p ON p.school_id = r.school_id
WHERE COALESCE(r.receipt_status::text, '') <> 'cancelled'
  AND r.payment_date >= p.start_at
  AND r.payment_date < p.end_at
GROUP BY r.academic_year
ORDER BY r.academic_year;

-- Montant à recouvrer de l'année courante : indépendant du filtre de date.
WITH dettes AS (
  SELECT COALESCE(SUM(base_amount), 0) AS total_facture
  FROM finance.student_charges
  WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    AND academic_year = '2026-2027'
    AND COALESCE(status::text, '') <> 'cancelled'
),
recus AS (
  SELECT COALESCE(SUM(total_amount), 0) AS total_encaisse
  FROM finance.receipts
  WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    AND academic_year = '2026-2027'
    AND COALESCE(receipt_status::text, '') <> 'cancelled'
)
SELECT
  d.total_facture,
  r.total_encaisse,
  d.total_facture - r.total_encaisse AS reste_a_recouvrer
FROM dettes d
CROSS JOIN recus r;
