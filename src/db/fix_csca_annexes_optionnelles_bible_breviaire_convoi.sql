-- ============================================================
-- Thème : CSCA — frais annexes internat optionnels
-- Établissement : COURS SECONDAIRE CATHOLIQUE ABOISSO
-- institution_id : ee34ab2a-8033-4e0b-acf0-05979cce1697
-- Année : 2026-2027
--
-- Règle métier appliquée :
-- - Bréviaire, Bible Africaine et Convoi internat ne sont PAS facturés
--   lorsqu'ils restent à 0 F.
-- - Dès qu'un montant est saisi/payé sur l'un de ces éléments, l'élément
--   concerné est engagé et son montant attendu rentre dans la dette.
-- - Les autres sous-rubriques des frais annexes internat restent dues.
--
-- Effet attendu si rien n'est saisi sur ces 3 éléments :
-- frais annexes internat = 230 000 - 13 000 - 8 500 - 30 000 = 178 500 F.
-- ============================================================

BEGIN;

WITH params AS (
  SELECT
    'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id,
    '2026-2027'::text AS academic_year
),
target_schedules AS (
  SELECT fs.id, fs.label
  FROM finance.fee_schedules fs
  JOIN params p ON p.school_id = fs.school_id
  WHERE fs.academic_year = p.academic_year
    AND fs.is_active IS TRUE
    AND lower(fs.label) LIKE '%internat%'
    AND lower(fs.label) LIKE '%frais%'
    AND lower(fs.label) LIKE '%annexe%'
),
schedule_components AS (
  SELECT
    fsc.fee_schedule_id,
    fsc.id AS component_id,
    fsc.label,
    COALESCE(fsc.amount, 0)::numeric AS amount,
    (
      fsc.label ILIKE '%Bréviaire%'
      OR fsc.label ILIKE '%Breviaire%'
      OR fsc.label ILIKE '%Bible%'
      OR fsc.label ILIKE '%Convoi%'
    ) AS is_optional
  FROM finance.fee_schedule_components fsc
  JOIN target_schedules ts ON ts.id = fsc.fee_schedule_id
  JOIN params p ON p.school_id = fsc.school_id
  WHERE fsc.is_active IS TRUE
),
schedule_totals AS (
  SELECT
    fee_schedule_id,
    COALESCE(SUM(amount) FILTER (WHERE NOT is_optional), 0)::numeric AS mandatory_base,
    COALESCE(SUM(amount) FILTER (WHERE is_optional), 0)::numeric AS optional_base
  FROM schedule_components
  GROUP BY fee_schedule_id
),
updated_schedules AS (
  UPDATE finance.fee_schedules fs
  SET
    amount = st.mandatory_base,
    notes = CASE
      WHEN COALESCE(fs.notes, '') ILIKE '%[CSCA CONVOI OPTIONNEL]%'
        THEN fs.notes
      ELSE CONCAT(
        COALESCE(fs.notes, ''),
        E'\n[CSCA CONVOI OPTIONNEL] Barème frais annexes recalculé hors Bréviaire, Bible Africaine et Convoi internat tant que ces éléments restent à 0 F.'
      )
    END
  FROM schedule_totals st
  WHERE fs.id = st.fee_schedule_id
    AND fs.amount IS DISTINCT FROM st.mandatory_base
  RETURNING fs.id, fs.label, fs.amount
),
annex_charges AS (
  SELECT
    sc.id,
    sc.fee_schedule_id,
    sc.status,
    sc.base_amount
  FROM finance.student_charges sc
  JOIN params p ON p.school_id = sc.school_id
  JOIN target_schedules ts ON ts.id = sc.fee_schedule_id
  WHERE sc.academic_year = p.academic_year
    AND COALESCE(sc.status::text, '') <> 'cancelled'
),
posted_allocations AS (
  SELECT
    ac.id AS student_charge_id,
    ra.id AS allocation_id,
    COALESCE(ra.amount, 0)::numeric AS allocation_amount
  FROM annex_charges ac
  JOIN finance.receipt_allocations ra
    ON ra.student_charge_id = ac.id
  JOIN finance.receipts r
    ON r.id = ra.receipt_id
   AND COALESCE(r.receipt_status::text, '') <> 'cancelled'
),
allocation_totals AS (
  SELECT
    student_charge_id,
    COALESCE(SUM(allocation_amount), 0)::numeric AS total_paid
  FROM posted_allocations
  GROUP BY student_charge_id
),
component_paid AS (
  SELECT
    pa.student_charge_id,
    rac.fee_schedule_component_id AS component_id,
    COALESCE(SUM(rac.amount), 0)::numeric AS paid_amount
  FROM posted_allocations pa
  JOIN finance.receipt_allocation_components rac
    ON rac.receipt_allocation_id = pa.allocation_id
   AND COALESCE(rac.amount, 0) > 0
  GROUP BY pa.student_charge_id, rac.fee_schedule_component_id
),
charge_recalc AS (
  SELECT
    ac.id AS student_charge_id,
    st.mandatory_base,
    COALESCE(SUM(sc.amount) FILTER (
      WHERE sc.is_optional AND COALESCE(cp.paid_amount, 0) > 0
    ), 0)::numeric AS optional_engaged_base,
    COALESCE(at.total_paid, 0)::numeric AS total_paid
  FROM annex_charges ac
  JOIN schedule_totals st ON st.fee_schedule_id = ac.fee_schedule_id
  JOIN schedule_components sc ON sc.fee_schedule_id = ac.fee_schedule_id
  LEFT JOIN component_paid cp
    ON cp.student_charge_id = ac.id
   AND cp.component_id = sc.component_id
  LEFT JOIN allocation_totals at ON at.student_charge_id = ac.id
  GROUP BY ac.id, st.mandatory_base, at.total_paid
),
updated_charges AS (
  UPDATE finance.student_charges sc
  SET
    base_amount = cr.mandatory_base + cr.optional_engaged_base,
    status = CASE
      WHEN cr.total_paid >= (cr.mandatory_base + cr.optional_engaged_base) - 0.01
        THEN 'paid'::finance.charge_status
      WHEN cr.total_paid > 0
        THEN 'partial'::finance.charge_status
      ELSE 'pending'::finance.charge_status
    END,
    notes = CASE
      WHEN COALESCE(sc.notes, '') ILIKE '%[CSCA CONVOI OPTIONNEL]%'
        THEN sc.notes
      ELSE CONCAT(
        COALESCE(sc.notes, ''),
        E'\n[CSCA CONVOI OPTIONNEL] Frais annexes recalculés : Bréviaire, Bible Africaine et Convoi internat ajoutés seulement si engagés/payés.'
      )
    END,
    updated_at = now()
  FROM charge_recalc cr
  WHERE sc.id = cr.student_charge_id
    AND (
      sc.base_amount IS DISTINCT FROM (cr.mandatory_base + cr.optional_engaged_base)
      OR sc.status::text IS DISTINCT FROM CASE
        WHEN cr.total_paid >= (cr.mandatory_base + cr.optional_engaged_base) - 0.01 THEN 'paid'
        WHEN cr.total_paid > 0 THEN 'partial'
        ELSE 'pending'
      END
    )
  RETURNING sc.id, sc.base_amount, sc.status
)
SELECT
  (SELECT COUNT(*) FROM target_schedules) AS baremes_annexes_trouves,
  (SELECT COUNT(*) FROM updated_schedules) AS baremes_mis_a_jour,
  (SELECT COUNT(*) FROM annex_charges) AS dettes_annexes_trouvees,
  (SELECT COUNT(*) FROM updated_charges) AS dettes_mises_a_jour,
  (SELECT COALESCE(SUM(base_amount), 0) FROM updated_charges) AS total_base_mise_a_jour;

COMMIT;

-- Contrôle après correction : les trois éléments optionnels doivent apparaître ici.
SELECT
  fsc.label AS sous_rubrique,
  fsc.amount AS montant_attendu,
  CASE
    WHEN fsc.label ILIKE '%Bréviaire%'
      OR fsc.label ILIKE '%Breviaire%'
      OR fsc.label ILIKE '%Bible%'
      OR fsc.label ILIKE '%Convoi%'
    THEN 'OPTIONNEL_NON_FACTURE_SI_0'
    ELSE 'OBLIGATOIRE'
  END AS comportement
FROM finance.fee_schedule_components fsc
JOIN finance.fee_schedules fs ON fs.id = fsc.fee_schedule_id
WHERE fs.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND fs.academic_year = '2026-2027'
  AND lower(fs.label) LIKE '%internat%'
  AND lower(fs.label) LIKE '%frais%'
  AND lower(fs.label) LIKE '%annexe%'
  AND fsc.is_active IS TRUE
ORDER BY fsc.order_index NULLS LAST, fsc.label;

-- Contrôle attendu pour un élève sans Bréviaire/Bible/Convoi engagé :
-- base_amount des frais annexes internat = 178 500 F.
SELECT
  sc.label,
  COUNT(*) AS lignes,
  MIN(sc.base_amount) AS minimum_facture,
  MAX(sc.base_amount) AS maximum_facture,
  COALESCE(SUM(sc.base_amount), 0) AS total_facture
FROM finance.student_charges sc
WHERE sc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND sc.academic_year = '2026-2027'
  AND lower(sc.label) LIKE '%internat%'
  AND lower(sc.label) LIKE '%frais%'
  AND lower(sc.label) LIKE '%annexe%'
  AND COALESCE(sc.status::text, '') <> 'cancelled'
GROUP BY sc.label;
