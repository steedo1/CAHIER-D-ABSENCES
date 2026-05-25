-- ============================================================
-- CSCA — NETTOYAGE FINANCE 2025-2026 UNIQUEMENT
-- Ne touche PAS aux élèves, classes, inscriptions, catégories générales.
-- Supprime uniquement les données finance 2025-2026 du CSCA :
-- reçus, ventilations, détails annexes, dettes, barèmes et composants de barèmes.
-- ============================================================

BEGIN;

WITH params AS (
  SELECT
    'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id,
    '2025-2026'::text AS academic_year
),
target_receipts AS (
  SELECT r.id
  FROM finance.receipts r
  JOIN params p ON p.school_id = r.school_id
  WHERE r.academic_year = p.academic_year
),
target_charges AS (
  SELECT sc.id
  FROM finance.student_charges sc
  JOIN params p ON p.school_id = sc.school_id
  WHERE sc.academic_year = p.academic_year
),
target_schedules AS (
  SELECT fs.id
  FROM finance.fee_schedules fs
  JOIN params p ON p.school_id = fs.school_id
  WHERE fs.academic_year = p.academic_year
),
target_allocations AS (
  SELECT ra.id
  FROM finance.receipt_allocations ra
  WHERE ra.receipt_id IN (SELECT id FROM target_receipts)
     OR ra.student_charge_id IN (SELECT id FROM target_charges)
),
deleted_receipt_components AS (
  DELETE FROM finance.receipt_allocation_components rac
  WHERE rac.receipt_allocation_id IN (SELECT id FROM target_allocations)
  RETURNING rac.id
),
deleted_allocations AS (
  DELETE FROM finance.receipt_allocations ra
  WHERE ra.id IN (SELECT id FROM target_allocations)
  RETURNING ra.id, ra.amount
),
deleted_receipts AS (
  DELETE FROM finance.receipts r
  WHERE r.id IN (SELECT id FROM target_receipts)
  RETURNING r.id, r.total_amount
),
deleted_charges AS (
  DELETE FROM finance.student_charges sc
  WHERE sc.id IN (SELECT id FROM target_charges)
  RETURNING sc.id, sc.base_amount
),
deleted_schedule_components AS (
  DELETE FROM finance.fee_schedule_components fsc
  WHERE fsc.fee_schedule_id IN (SELECT id FROM target_schedules)
  RETURNING fsc.id
),
deleted_schedules AS (
  DELETE FROM finance.fee_schedules fs
  WHERE fs.id IN (SELECT id FROM target_schedules)
  RETURNING fs.id, fs.amount
)
SELECT
  (SELECT COUNT(*) FROM deleted_receipts) AS recus_supprimes,
  (SELECT COALESCE(SUM(total_amount), 0) FROM deleted_receipts) AS montant_recus_supprime,
  (SELECT COUNT(*) FROM deleted_allocations) AS ventilations_supprimees,
  (SELECT COALESCE(SUM(amount), 0) FROM deleted_allocations) AS montant_ventilations_supprime,
  (SELECT COUNT(*) FROM deleted_receipt_components) AS details_recus_supprimes,
  (SELECT COUNT(*) FROM deleted_charges) AS dettes_supprimees,
  (SELECT COALESCE(SUM(base_amount), 0) FROM deleted_charges) AS montant_dettes_supprime,
  (SELECT COUNT(*) FROM deleted_schedule_components) AS composants_baremes_supprimes,
  (SELECT COUNT(*) FROM deleted_schedules) AS baremes_supprimes;

COMMIT;

-- Contrôle attendu : 0 partout pour 2025-2026.
SELECT
  'receipts' AS table_name,
  COUNT(*) AS lignes,
  COALESCE(SUM(total_amount), 0) AS total
FROM finance.receipts
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2025-2026'

UNION ALL

SELECT
  'student_charges',
  COUNT(*),
  COALESCE(SUM(base_amount), 0)
FROM finance.student_charges
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2025-2026'

UNION ALL

SELECT
  'fee_schedules',
  COUNT(*),
  COALESCE(SUM(amount), 0)
FROM finance.fee_schedules
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2025-2026';
