-- ============================================================
-- MON CAHIER — Correction Internat variable / sous-rubriques
-- CSCA 2026-2027
--
-- Objectif :
-- 1) Les frais annexes internat restent variables.
-- 2) Les sous-rubriques non cochées lors d'un paiement restent disponibles
--    pour un prochain encaissement.
-- 3) Les anciennes dettes automatiques annulées sont rouvertes en lignes
--    techniques à 0 F afin que l'écran Encaissements puisse afficher les
--    composants sans regonfler le total à recouvrer.
--
-- Ne touche pas aux élèves, classes, scolarité, pension, reçus ni paiements.
-- ============================================================

BEGIN;

WITH params AS (
  SELECT
    'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id,
    '2026-2027'::text AS academic_year
),
reopened AS (
  UPDATE finance.student_charges sc
  SET
    status = 'pending'::finance.charge_status,
    base_amount = 0,
    notes = CONCAT(
      COALESCE(sc.notes, ''),
      E'\n[INTERNAT VARIABLE] Ligne technique rouverte à 0 F : les sous-rubriques restent cochables sans gonfler le total.'
    ),
    updated_at = now()
  FROM params p
  WHERE sc.school_id = p.school_id
    AND sc.academic_year = p.academic_year
    AND sc.label = 'Internat - Frais annexes internat'
    AND COALESCE(sc.status::text, '') = 'cancelled'
    AND NOT EXISTS (
      SELECT 1
      FROM finance.receipt_allocations ra
      JOIN finance.receipts r
        ON r.id = ra.receipt_id
       AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
      WHERE ra.student_charge_id = sc.id
    )
  RETURNING sc.id, sc.student_id, sc.base_amount
),
zero_component_marks AS (
  SELECT COUNT(*) AS n
  FROM finance.receipt_allocation_components rac
  WHERE rac.amount = 0
)
SELECT
  (SELECT COUNT(*) FROM reopened) AS lignes_annexes_rouvertes_a_zero,
  (SELECT COUNT(*) FROM zero_component_marks) AS anciennes_sous_rubriques_marquees_zero;

COMMIT;

-- Contrôle : le total des dettes ne doit pas augmenter, car les lignes rouvertes
-- ont base_amount = 0.
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
