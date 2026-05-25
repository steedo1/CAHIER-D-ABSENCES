-- ============================================================
-- CSCA 2026-2027 — INTERNAT VARIABLE + CONTRÔLES REÇUS
-- Établissement : COURS SECONDAIRE CATHOLIQUE ABOISSO
-- institution_id : ee34ab2a-8033-4e0b-acf0-05979cce1697
--
-- Objectif :
-- 1) Ne plus considérer "Internat - Frais annexes internat" comme
--    une dette fixe automatique de 230 000 F pour tous les internes.
-- 2) Conserver uniquement les frais annexes internat réellement
--    confirmés par un reçu/une ventilation existante.
-- 3) Annuler les lignes automatiques non confirmées et non encaissées.
--
-- Ce script ne touche pas :
-- - aux élèves ;
-- - aux classes ;
-- - à la scolarité ;
-- - à la pension internat ;
-- - aux vrais reçus 2026-2027.
-- ============================================================

BEGIN;

WITH params AS (
  SELECT
    'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id,
    '2026-2027'::text AS academic_year
),
annexe_charges AS (
  SELECT sc.id, sc.base_amount
  FROM finance.student_charges sc
  JOIN params p
    ON p.school_id = sc.school_id
   AND p.academic_year = sc.academic_year
  WHERE COALESCE(sc.status::text, '') <> 'cancelled'
    AND sc.label = 'Internat - Frais annexes internat'
),
posted_allocations AS (
  SELECT
    ra.student_charge_id,
    SUM(ra.amount) AS allocated_total
  FROM finance.receipt_allocations ra
  JOIN finance.receipts r
    ON r.id = ra.receipt_id
   AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
  JOIN annexe_charges ac
    ON ac.id = ra.student_charge_id
  GROUP BY ra.student_charge_id
),
component_totals AS (
  SELECT
    ra.student_charge_id,
    SUM(rac.amount) AS component_total
  FROM finance.receipt_allocation_components rac
  JOIN finance.receipt_allocations ra
    ON ra.id = rac.receipt_allocation_id
  JOIN finance.receipts r
    ON r.id = ra.receipt_id
   AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
  JOIN annexe_charges ac
    ON ac.id = ra.student_charge_id
  GROUP BY ra.student_charge_id
),
confirmed_annexes AS (
  SELECT
    ac.id,
    GREATEST(
      COALESCE(NULLIF(ct.component_total, 0), 0),
      COALESCE(pa.allocated_total, 0)
    ) AS confirmed_amount
  FROM annexe_charges ac
  LEFT JOIN posted_allocations pa
    ON pa.student_charge_id = ac.id
  LEFT JOIN component_totals ct
    ON ct.student_charge_id = ac.id
  WHERE COALESCE(pa.allocated_total, 0) > 0
     OR COALESCE(ct.component_total, 0) > 0
),
updated_confirmed AS (
  UPDATE finance.student_charges sc
  SET
    base_amount = ca.confirmed_amount,
    notes = CONCAT(
      COALESCE(sc.notes, ''),
      E'\n[INTERNAT VARIABLE] Frais annexes ramenés au montant réellement confirmé/ventilé.'
    ),
    updated_at = now()
  FROM confirmed_annexes ca
  WHERE sc.id = ca.id
    AND ca.confirmed_amount >= 0
    AND sc.base_amount IS DISTINCT FROM ca.confirmed_amount
  RETURNING sc.id, sc.base_amount
),
cancelled_unconfirmed AS (
  UPDATE finance.student_charges sc
  SET
    status = 'cancelled'::finance.charge_status,
    notes = CONCAT(
      COALESCE(sc.notes, ''),
      E'\n[INTERNAT VARIABLE] Dette automatique de frais annexes internat annulée : aucun composant confirmé, aucun reçu lié.'
    ),
    updated_at = now()
  WHERE sc.id IN (SELECT id FROM annexe_charges)
    AND sc.id NOT IN (SELECT id FROM confirmed_annexes)
    AND NOT EXISTS (
      SELECT 1
      FROM finance.receipt_allocations ra
      JOIN finance.receipts r
        ON r.id = ra.receipt_id
       AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
      WHERE ra.student_charge_id = sc.id
    )
  RETURNING sc.id, sc.base_amount
)
SELECT
  (SELECT COUNT(*) FROM annexe_charges) AS annexes_actives_avant,
  (SELECT COUNT(*) FROM confirmed_annexes) AS annexes_confirmees_conservees,
  (SELECT COALESCE(SUM(confirmed_amount), 0) FROM confirmed_annexes) AS montant_annexes_confirmees,
  (SELECT COUNT(*) FROM updated_confirmed) AS annexes_confirmees_ajustees,
  (SELECT COUNT(*) FROM cancelled_unconfirmed) AS annexes_non_confirmees_annulees,
  (SELECT COALESCE(SUM(base_amount), 0) FROM cancelled_unconfirmed) AS montant_annexe_annule;

COMMIT;

-- ============================================================
-- CONTRÔLE FINAL 2026-2027
-- ============================================================

WITH dettes AS (
  SELECT
    COUNT(DISTINCT sc.student_id) AS eleves_factures,
    COUNT(*) AS lignes_dettes,
    COALESCE(SUM(sc.base_amount), 0) AS total_exigible
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
  d.eleves_factures,
  d.lignes_dettes,
  d.total_exigible,
  r.total_encaisse,
  d.total_exigible - r.total_encaisse AS reste_a_recouvrer
FROM dettes d
CROSS JOIN recus r;

-- Détail par rubrique après correction.
SELECT
  sc.label,
  COUNT(*) AS lignes,
  COALESCE(SUM(sc.base_amount), 0) AS total
FROM finance.student_charges sc
WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND sc.academic_year = '2026-2027'
  AND COALESCE(sc.status::text, '') <> 'cancelled'
GROUP BY sc.label
ORDER BY sc.label;
