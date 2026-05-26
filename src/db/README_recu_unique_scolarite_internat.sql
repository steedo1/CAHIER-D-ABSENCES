-- Patch applicatif uniquement : aucun SQL obligatoire.
-- Contrôles recommandés après déploiement :

-- 1) Vérifier que les frais annexes internat n'ont plus de doublons actifs.
SELECT label, COUNT(*) AS lignes, COUNT(DISTINCT student_id) AS eleves, SUM(base_amount) AS total
FROM finance.student_charges
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2026-2027'
  AND COALESCE(status::text, '') <> 'cancelled'
GROUP BY label
ORDER BY label;

-- 2) Vérifier les reçus actifs.
SELECT receipt_no, total_amount, academic_year, payment_date, created_at
FROM finance.receipts
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2026-2027'
  AND COALESCE(receipt_status::text, '') <> 'cancelled'
ORDER BY created_at DESC;
