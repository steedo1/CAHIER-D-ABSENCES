-- CSCA 2026-2027 — frais annexes internat : base obligatoire hors Bréviaire/Bible
-- À exécuter après le patch applicatif.
-- Règle :
-- - Kit cahier, argent de poche, entretien toilettes, études surveillées,
--   convoi, trousseau et autres frais restent dus tant qu'ils ne sont pas soldés.
-- - Bréviaire et Bible Africaine n'entrent dans la dette que si un montant a déjà
--   été payé/engagé dessus.
-- - La pension reste séparée à 700 000 F.

BEGIN;

WITH params AS (
  SELECT
    'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id,
    '2026-2027'::text AS academic_year
),
annex_charges AS (
  SELECT
    sc.id,
    sc.fee_schedule_id
  FROM finance.student_charges sc
  JOIN params p ON p.school_id = sc.school_id
  WHERE sc.academic_year = p.academic_year
    AND sc.label = 'Internat - Frais annexes internat'
    AND COALESCE(sc.status::text, '') <> 'cancelled'
),
component_paid AS (
  SELECT
    ac.id AS student_charge_id,
    rac.fee_schedule_component_id,
    COALESCE(SUM(rac.amount), 0) AS paid_amount
  FROM annex_charges ac
  JOIN finance.receipt_allocations ra
    ON ra.student_charge_id = ac.id
  JOIN finance.receipts r
    ON r.id = ra.receipt_id
   AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
  JOIN finance.receipt_allocation_components rac
    ON rac.receipt_allocation_id = ra.id
   AND COALESCE(rac.amount, 0) > 0
  GROUP BY ac.id, rac.fee_schedule_component_id
),
component_base AS (
  SELECT
    ac.id AS student_charge_id,
    COALESCE(SUM(fsc.amount) FILTER (
      WHERE (fsc.label NOT ILIKE '%Bréviaire%' AND fsc.label NOT ILIKE '%Breviaire%' AND fsc.label NOT ILIKE '%Bible%')
    ), 0) AS mandatory_base,
    COALESCE(SUM(fsc.amount) FILTER (
      WHERE (
          fsc.label ILIKE '%Bréviaire%' OR fsc.label ILIKE '%Breviaire%' OR fsc.label ILIKE '%Bible%'
        )
        AND COALESCE(cp.paid_amount, 0) > 0
    ), 0) AS optional_engaged_base,
    COALESCE(SUM(cp.paid_amount), 0) AS total_paid_components
  FROM annex_charges ac
  JOIN finance.fee_schedule_components fsc
    ON fsc.fee_schedule_id = ac.fee_schedule_id
   AND fsc.school_id = (SELECT school_id FROM params)
   AND fsc.is_active IS TRUE
  LEFT JOIN component_paid cp
    ON cp.student_charge_id = ac.id
   AND cp.fee_schedule_component_id = fsc.id
  GROUP BY ac.id
),
recalc AS (
  UPDATE finance.student_charges sc
  SET
    base_amount = CASE
      WHEN cb.mandatory_base + cb.optional_engaged_base > 0
        THEN cb.mandatory_base + cb.optional_engaged_base
      ELSE 208500
    END,
    status = CASE
      WHEN cb.total_paid_components >=
        (CASE
          WHEN cb.mandatory_base + cb.optional_engaged_base > 0
            THEN cb.mandatory_base + cb.optional_engaged_base
          ELSE 208500
        END) - 0.01
        THEN 'paid'::finance.charge_status
      WHEN cb.total_paid_components > 0
        THEN 'partial'::finance.charge_status
      ELSE 'pending'::finance.charge_status
    END,
    notes = CONCAT(
      COALESCE(sc.notes, ''),
      E'\n[CORRECTION] Frais annexes internat recalculés : base obligatoire hors Bréviaire/Bible ; Bréviaire/Bible ajoutés seulement si engagés.'
    ),
    updated_at = now()
  FROM component_base cb
  WHERE sc.id = cb.student_charge_id
  RETURNING sc.id, sc.base_amount
)
SELECT
  COUNT(*) AS lignes_recalculees,
  COALESCE(SUM(base_amount), 0) AS total_frais_annexes_recalcule
FROM recalc;

COMMIT;

-- Contrôle attendu : 211 lignes / 211 élèves ; total proche de 43 993 500 F
-- si seul un élève a engagé 208 500 F et les autres restent au minimum 208 500 F.
SELECT
  label,
  COUNT(*) AS lignes,
  COUNT(DISTINCT student_id) AS eleves,
  COALESCE(SUM(base_amount), 0) AS total
FROM finance.student_charges
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2026-2027'
  AND label = 'Internat - Frais annexes internat'
  AND COALESCE(status::text, '') <> 'cancelled'
GROUP BY label;
