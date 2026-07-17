-- ============================================================================
-- MON CAHIER - Moteur unique de synchronisation financière des élèves
-- Version 1 - générique multi-établissements
--
-- À exécuter AVANT de déployer le correctif TypeScript associé.
-- Ce script ne supprime aucun paiement et aucun reçu.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 1. Les règles d'application appartiennent désormais au barème.
ALTER TABLE finance.fee_schedules
  ADD COLUMN IF NOT EXISTS applies_when_affecte boolean,
  ADD COLUMN IF NOT EXISTS applies_when_boarder boolean,
  ADD COLUMN IF NOT EXISTS amount_mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS profile_group_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fee_schedules_amount_mode_check'
      AND conrelid = 'finance.fee_schedules'::regclass
  ) THEN
    ALTER TABLE finance.fee_schedules
      ADD CONSTRAINT fee_schedules_amount_mode_check
      CHECK (amount_mode IN ('fixed', 'components'));
  END IF;
END $$;

COMMENT ON COLUMN finance.fee_schedules.applies_when_affecte IS
  'NULL=tous les statuts, TRUE=affectés seulement, FALSE=non affectés seulement.';
COMMENT ON COLUMN finance.fee_schedules.applies_when_boarder IS
  'NULL=tous les régimes, TRUE=internes seulement, FALSE=externes seulement.';
COMMENT ON COLUMN finance.fee_schedules.amount_mode IS
  'fixed=montant du barème, components=somme des composants obligatoires et options retenues.';
COMMENT ON COLUMN finance.fee_schedules.profile_group_key IS
  'Même clé pour les variantes d''une rubrique (par exemple affecté/non affecté) afin de conserver une seule dette lors d''un changement de profil.';

-- 2. Le caractère optionnel est une donnée, jamais une déduction par libellé.
ALTER TABLE finance.fee_schedule_components
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN finance.fee_schedule_components.is_optional IS
  'Une option n''entre dans la dette que lorsqu''elle est sélectionnée pour l''élève.';

-- 3. Clé d'idempotence réservée aux dettes gérées automatiquement.
ALTER TABLE finance.student_charges
  ADD COLUMN IF NOT EXISTS sync_key text;

COMMENT ON COLUMN finance.student_charges.sync_key IS
  'Clé stable du moteur automatique. NULL pour les dettes historiques/manuelles non reprises.';

-- 4. Sélection persistante des options, indépendante des paiements et reçus.
CREATE TABLE IF NOT EXISTS finance.student_charge_component_selections (
  school_id uuid NOT NULL,
  student_charge_id uuid NOT NULL
    REFERENCES finance.student_charges(id) ON DELETE CASCADE,
  fee_schedule_component_id uuid NOT NULL
    REFERENCES finance.fee_schedule_components(id) ON DELETE RESTRICT,
  selected_by uuid,
  selected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_charge_id, fee_schedule_component_id)
);

CREATE INDEX IF NOT EXISTS student_charge_component_selections_school_idx
  ON finance.student_charge_component_selections (school_id, student_charge_id);

CREATE OR REPLACE FUNCTION finance.validate_student_charge_component_selection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public
AS $$
DECLARE
  charge_school uuid;
  charge_schedule uuid;
  component_school uuid;
  component_schedule uuid;
  component_optional boolean;
BEGIN
  SELECT sc.school_id, sc.fee_schedule_id
    INTO charge_school, charge_schedule
  FROM finance.student_charges sc
  WHERE sc.id = NEW.student_charge_id;

  SELECT fsc.school_id, fsc.fee_schedule_id, fsc.is_optional
    INTO component_school, component_schedule, component_optional
  FROM finance.fee_schedule_components fsc
  WHERE fsc.id = NEW.fee_schedule_component_id;

  IF charge_school IS NULL OR component_school IS NULL THEN
    RAISE EXCEPTION 'Dette ou composant introuvable.';
  END IF;
  IF NEW.school_id <> charge_school OR NEW.school_id <> component_school THEN
    RAISE EXCEPTION 'Établissement incohérent pour la sélection d''option.';
  END IF;
  IF charge_schedule IS DISTINCT FROM component_schedule THEN
    RAISE EXCEPTION 'Le composant ne correspond pas au barème de la dette.';
  END IF;
  IF component_optional IS NOT TRUE THEN
    RAISE EXCEPTION 'Seuls les composants optionnels doivent être sélectionnés.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_student_charge_component_selection
  ON finance.student_charge_component_selections;
CREATE TRIGGER trg_validate_student_charge_component_selection
BEFORE INSERT OR UPDATE ON finance.student_charge_component_selections
FOR EACH ROW
EXECUTE FUNCTION finance.validate_student_charge_component_selection();

GRANT SELECT ON finance.student_charge_component_selections TO authenticated;

-- 5. Reprise de compatibilité des anciens barèmes.
-- Cette déduction est exécutée une seule fois. Ensuite, l'application lit les
-- colonnes explicites ci-dessus et chaque établissement peut les paramétrer.
UPDATE finance.fee_schedules fs
SET applies_when_affecte = false
WHERE applies_when_affecte IS NULL
  AND lower(unaccent(coalesce(fs.label, ''))) LIKE '%non affect%';

UPDATE finance.fee_schedules fs
SET applies_when_affecte = true
WHERE applies_when_affecte IS NULL
  AND lower(unaccent(coalesce(fs.label, ''))) LIKE '%affect%'
  AND lower(unaccent(coalesce(fs.label, ''))) NOT LIKE '%non affect%';

UPDATE finance.fee_schedules fs
SET profile_group_key = trim(
  regexp_replace(
    regexp_replace(
      lower(unaccent(coalesce(fs.label, ''))),
      '(non[ -]?affecte|re[ -]?affecte|affecte)',
      ' ',
      'g'
    ),
    '\s+',
    ' ',
    'g'
  )
)
WHERE fs.profile_group_key IS NULL
  AND fs.applies_when_affecte IS NOT NULL;

UPDATE finance.fee_schedules fs
SET applies_when_boarder = true
FROM finance.fee_categories fc
WHERE fc.id = fs.fee_category_id
  AND fc.school_id = fs.school_id
  AND fs.applies_when_boarder IS NULL
  AND (
    lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%internat%'
    OR lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%pension%'
    OR lower(unaccent(coalesce(fs.label, ''))) LIKE '%internat%'
    OR lower(unaccent(coalesce(fs.label, ''))) LIKE '%pension%'
  );

-- Paramétrage CSCA 2026-2027 : règle locale, isolée du moteur générique.
UPDATE finance.fee_schedule_components fsc
SET is_optional = true,
    updated_at = now()
FROM finance.fee_schedules fs
WHERE fs.id = fsc.fee_schedule_id
  AND fs.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND fs.academic_year = '2026-2027'
  AND (
    lower(unaccent(coalesce(fsc.component_code, ''))) IN
      ('breviaire', 'bible_africaine', 'convoi_internat')
    OR lower(unaccent(coalesce(fsc.label, ''))) LIKE '%breviaire%'
    OR lower(unaccent(coalesce(fsc.label, ''))) LIKE '%bible%'
    OR lower(unaccent(coalesce(fsc.label, ''))) LIKE '%convoi%'
  );

UPDATE finance.fee_schedules fs
SET amount_mode = 'components',
    applies_when_boarder = true,
    updated_at = now()
WHERE fs.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND fs.academic_year = '2026-2027'
  AND EXISTS (
    SELECT 1
    FROM finance.fee_schedule_components fsc
    WHERE fsc.fee_schedule_id = fs.id
      AND fsc.is_active IS TRUE
      AND fsc.is_optional IS TRUE
  );

-- 6. Toute option déjà payée devient automatiquement une option retenue.
INSERT INTO finance.student_charge_component_selections (
  school_id,
  student_charge_id,
  fee_schedule_component_id,
  selected_by,
  selected_at,
  created_at,
  updated_at
)
SELECT DISTINCT
  r.school_id,
  ra.student_charge_id,
  rac.fee_schedule_component_id,
  r.created_by,
  COALESCE(r.payment_date, r.created_at, now()),
  now(),
  now()
FROM finance.receipt_allocation_components rac
JOIN finance.receipt_allocations ra ON ra.id = rac.receipt_allocation_id
JOIN finance.receipts r ON r.id = ra.receipt_id
JOIN finance.student_charges sc ON sc.id = ra.student_charge_id
JOIN finance.fee_schedule_components fsc
  ON fsc.id = rac.fee_schedule_component_id
 AND fsc.fee_schedule_id = sc.fee_schedule_id
 AND fsc.school_id = sc.school_id
WHERE COALESCE(r.receipt_status::text, '') <> 'cancelled'
  AND COALESCE(rac.amount, 0) > 0
  AND fsc.is_optional IS TRUE
ON CONFLICT (student_charge_id, fee_schedule_component_id) DO NOTHING;

-- 7. Reconstitution générique des anciennes options non encore payées.
-- Uniquement si une combinaison UNIQUE (maximum 12 options) explique exactement
-- le montant historique. En cas d'ambiguïté, aucune supposition n'est faite.
WITH RECURSIVE
active_components AS (
  SELECT
    fsc.fee_schedule_id,
    fsc.id,
    fsc.amount,
    fsc.is_optional
  FROM finance.fee_schedule_components fsc
  WHERE fsc.is_active IS TRUE
),
component_totals AS (
  SELECT
    fee_schedule_id,
    COALESCE(SUM(amount) FILTER (WHERE NOT is_optional), 0) AS mandatory_total,
    COUNT(*) FILTER (WHERE is_optional) AS optional_count
  FROM active_components
  GROUP BY fee_schedule_id
),
optional_components AS (
  SELECT
    fee_schedule_id,
    id,
    amount,
    row_number() OVER (PARTITION BY fee_schedule_id ORDER BY id) AS rn
  FROM active_components
  WHERE is_optional
),
targets AS (
  SELECT
    sc.id AS charge_id,
    sc.school_id,
    sc.fee_schedule_id,
    ct.optional_count,
    round((sc.base_amount - ct.mandatory_total) * 100)::bigint AS target_cents,
    COALESCE((
      SELECT array_agg(scs.fee_schedule_component_id ORDER BY scs.fee_schedule_component_id)
      FROM finance.student_charge_component_selections scs
      WHERE scs.student_charge_id = sc.id
    ), ARRAY[]::uuid[]) AS required_ids
  FROM finance.student_charges sc
  JOIN finance.fee_schedules fs ON fs.id = sc.fee_schedule_id
  JOIN component_totals ct ON ct.fee_schedule_id = sc.fee_schedule_id
  WHERE fs.amount_mode = 'components'
    AND ct.optional_count BETWEEN 1 AND 12
    AND sc.base_amount >= ct.mandatory_total
),
subsets AS (
  SELECT
    t.charge_id,
    t.school_id,
    t.fee_schedule_id,
    t.optional_count,
    t.target_cents,
    t.required_ids,
    1 AS next_rn,
    0::bigint AS total_cents,
    ARRAY[]::uuid[] AS selected_ids
  FROM targets t

  UNION ALL

  SELECT
    s.charge_id,
    s.school_id,
    s.fee_schedule_id,
    s.optional_count,
    s.target_cents,
    s.required_ids,
    s.next_rn + 1,
    s.total_cents + CASE WHEN choice.take THEN round(oc.amount * 100)::bigint ELSE 0 END,
    CASE WHEN choice.take THEN s.selected_ids || oc.id ELSE s.selected_ids END
  FROM subsets s
  JOIN optional_components oc
    ON oc.fee_schedule_id = s.fee_schedule_id
   AND oc.rn = s.next_rn
  CROSS JOIN (VALUES (false), (true)) AS choice(take)
  WHERE s.next_rn <= s.optional_count
),
exact_matches AS (
  SELECT
    s.*,
    COUNT(*) OVER (PARTITION BY s.charge_id) AS match_count
  FROM subsets s
  WHERE s.next_rn = s.optional_count + 1
    AND s.total_cents = s.target_cents
    AND s.selected_ids @> s.required_ids
),
unique_matches AS (
  SELECT *
  FROM exact_matches
  WHERE match_count = 1
)
INSERT INTO finance.student_charge_component_selections (
  school_id,
  student_charge_id,
  fee_schedule_component_id,
  selected_by,
  selected_at,
  created_at,
  updated_at
)
SELECT
  um.school_id,
  um.charge_id,
  selected_id,
  NULL,
  now(),
  now(),
  now()
FROM unique_matches um
CROSS JOIN LATERAL unnest(um.selected_ids) AS selected_id
ON CONFLICT (student_charge_id, fee_schedule_component_id) DO NOTHING;

-- 8. Une seule dette automatique canonique reçoit une sync_key. Les éventuels
-- doublons historiques restent visibles au diagnostic et ne sont jamais fusionnés
-- silencieusement lorsqu'ils contiennent des paiements.
WITH paid AS (
  SELECT
    ra.student_charge_id,
    COALESCE(SUM(ra.amount), 0) AS paid_amount
  FROM finance.receipt_allocations ra
  JOIN finance.receipts r ON r.id = ra.receipt_id
  WHERE COALESCE(r.receipt_status::text, '') <> 'cancelled'
  GROUP BY ra.student_charge_id
),
ranked AS (
  SELECT
    sc.id,
    row_number() OVER (
      PARTITION BY sc.school_id, sc.student_id, sc.academic_year, sc.fee_schedule_id
      ORDER BY COALESCE(paid.paid_amount, 0) DESC, sc.updated_at DESC, sc.id
    ) AS rn
  FROM finance.student_charges sc
  LEFT JOIN paid ON paid.student_charge_id = sc.id
  WHERE sc.fee_schedule_id IS NOT NULL
    AND COALESCE(sc.status::text, '') <> 'cancelled'
)
UPDATE finance.student_charges sc
SET sync_key = sc.fee_schedule_id::text
FROM ranked r
WHERE r.id = sc.id
  AND r.rn = 1
  AND sc.sync_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS student_charges_sync_key_active_uidx
  ON finance.student_charges (
    school_id,
    student_id,
    COALESCE(academic_year, ''),
    sync_key
  )
  WHERE sync_key IS NOT NULL
    AND status <> 'cancelled'::finance.charge_status;

COMMIT;

-- ============================================================================
-- CONTRÔLES DE FIN DE MIGRATION - lecture seule
-- ============================================================================

SELECT
  COUNT(*) FILTER (WHERE applies_when_affecte IS NOT NULL) AS baremes_affectation_explicite,
  COUNT(*) FILTER (WHERE applies_when_boarder IS NOT NULL) AS baremes_internat_explicite,
  COUNT(*) FILTER (WHERE amount_mode = 'components') AS baremes_par_composants
FROM finance.fee_schedules
WHERE is_active IS TRUE;

SELECT
  COUNT(*) AS options_selectionnees,
  COUNT(DISTINCT student_charge_id) AS dettes_avec_options
FROM finance.student_charge_component_selections;

WITH paid AS (
  SELECT
    ra.student_charge_id,
    COALESCE(SUM(ra.amount), 0) AS paid_amount
  FROM finance.receipt_allocations ra
  JOIN finance.receipts r ON r.id = ra.receipt_id
  WHERE COALESCE(r.receipt_status::text, '') <> 'cancelled'
  GROUP BY ra.student_charge_id
), duplicate_groups AS (
  SELECT
    sc.school_id,
    sc.student_id,
    sc.academic_year,
    sc.fee_schedule_id,
    COUNT(*) AS active_charges,
    COUNT(*) FILTER (WHERE COALESCE(paid.paid_amount, 0) > 0) AS paid_charges,
    COALESCE(SUM(paid.paid_amount), 0) AS total_paid
  FROM finance.student_charges sc
  LEFT JOIN paid ON paid.student_charge_id = sc.id
  WHERE sc.fee_schedule_id IS NOT NULL
    AND COALESCE(sc.status::text, '') <> 'cancelled'
  GROUP BY sc.school_id, sc.student_id, sc.academic_year, sc.fee_schedule_id
  HAVING COUNT(*) > 1
)
SELECT *
FROM duplicate_groups
ORDER BY paid_charges DESC, active_charges DESC, academic_year, student_id;
