-- ============================================================
-- CSCA 2026-2027 — Internat variable : correction des frais annexes
-- Établissement : COURS SECONDAIRE CATHOLIQUE ABOISSO
-- institution_id : ee34ab2a-8033-4e0b-acf0-05979cce1697
--
-- Objectif :
-- 1) Ne plus considérer automatiquement 230 000 F de frais annexes
--    internat comme exigibles pour chaque interne.
-- 2) Conserver uniquement les frais annexes réellement confirmés/encaissés.
-- 3) Annuler les dettes "Internat - Frais annexes internat" sans aucun reçu.
--
-- Ne touche PAS à la scolarité.
-- Ne touche PAS à la pension.
-- Ne touche PAS aux reçus.
-- ============================================================

BEGIN;

WITH params AS (
  SELECT
    'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id,
    '2026-2027'::text AS academic_year
),
annex_charges AS (
  SELECT sc.id, sc.base_amount
  FROM finance.student_charges sc
  JOIN params p ON p.school_id = sc.school_id
  WHERE sc.academic_year = p.academic_year
    AND COALESCE(sc.status::text, '') <> 'cancelled'
    AND lower(sc.label) LIKE '%internat%'
    AND lower(sc.label) LIKE '%frais%'
    AND lower(sc.label) LIKE '%annexe%'
),
posted_allocations AS (
  SELECT
    ra.student_charge_id,
    ra.id AS allocation_id,
    ra.amount
  FROM finance.receipt_allocations ra
  JOIN finance.receipts r
    ON r.id = ra.receipt_id
   AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
  JOIN annex_charges ac
    ON ac.id = ra.student_charge_id
),
allocation_totals AS (
  SELECT
    student_charge_id,
    COALESCE(SUM(amount), 0) AS allocation_total
  FROM posted_allocations
  GROUP BY student_charge_id
),
component_totals AS (
  SELECT
    pa.student_charge_id,
    COALESCE(SUM(rac.amount), 0) AS component_total
  FROM posted_allocations pa
  JOIN finance.receipt_allocation_components rac
    ON rac.receipt_allocation_id = pa.allocation_id
  GROUP BY pa.student_charge_id
),
computed AS (
  SELECT
    ac.id,
    ac.base_amount,
    COALESCE(at.allocation_total, 0) AS allocation_total,
    COALESCE(ct.component_total, 0) AS component_total,
    GREATEST(COALESCE(at.allocation_total, 0), COALESCE(ct.component_total, 0)) AS confirmed_amount
  FROM annex_charges ac
  LEFT JOIN allocation_totals at ON at.student_charge_id = ac.id
  LEFT JOIN component_totals ct ON ct.student_charge_id = ac.id
),
cancelled AS (
  UPDATE finance.student_charges sc
  SET
    status = 'cancelled'::finance.charge_status,
    notes = CONCAT(
      COALESCE(sc.notes, ''),
      E'\n[INTERNAT VARIABLE] Frais annexes internat non confirmés : annulés pour ne plus gonfler le reste à recouvrer.'
    ),
    updated_at = now()
  FROM computed c
  WHERE sc.id = c.id
    AND c.confirmed_amount <= 0
  RETURNING sc.id, sc.base_amount
),
adjusted AS (
  UPDATE finance.student_charges sc
  SET
    base_amount = c.confirmed_amount,
    status = CASE
      WHEN c.allocation_total >= c.confirmed_amount THEN 'paid'::finance.charge_status
      ELSE 'partial'::finance.charge_status
    END,
    notes = CONCAT(
      COALESCE(sc.notes, ''),
      E'\n[INTERNAT VARIABLE] Montant ramené aux sous-rubriques réellement confirmées/encaissées.'
    ),
    updated_at = now()
  FROM computed c
  WHERE sc.id = c.id
    AND c.confirmed_amount > 0
    AND sc.base_amount IS DISTINCT FROM c.confirmed_amount
  RETURNING sc.id, sc.base_amount
)
SELECT
  (SELECT COUNT(*) FROM annex_charges) AS frais_annexes_avant,
  (SELECT COUNT(*) FROM cancelled) AS frais_annexes_annules,
  (SELECT COALESCE(SUM(base_amount), 0) FROM cancelled) AS montant_annule,
  (SELECT COUNT(*) FROM adjusted) AS frais_annexes_ajustes,
  (SELECT COALESCE(SUM(base_amount), 0) FROM adjusted) AS nouveau_montant_confirme;

COMMIT;

-- Contrôle attendu :
-- Le total facturé doit baisser d'environ 48 530 000 F si aucun frais annexe
-- internat n'est confirmé.
SELECT
  COUNT(*) AS lignes_dettes,
  COALESCE(SUM(base_amount), 0) AS total_facture
FROM finance.student_charges
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2026-2027'
  AND COALESCE(status::text, '') <> 'cancelled';

SELECT
  label,
  COUNT(*) AS lignes,
  COALESCE(SUM(base_amount), 0) AS total
FROM finance.student_charges
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2026-2027'
  AND COALESCE(status::text, '') <> 'cancelled'
GROUP BY label
ORDER BY label;
