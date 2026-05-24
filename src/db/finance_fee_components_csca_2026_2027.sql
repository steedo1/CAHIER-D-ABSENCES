-- ============================================================
-- MON CAHIER — Finance : détails de frais annexes
-- CSCA / PSAF — 2026-2027
--
-- Objectif :
--   - Garder les catégories principales : Scolarité / Internat.
--   - Garder la dette globale : Internat - Frais annexes internat = 230 000 F.
--   - Ajouter le détail cochable des composants de ces frais annexes.
--   - Enregistrer les composants réellement payés sur le reçu.
--
-- À exécuter une seule fois dans Supabase SQL Editor avant de déployer
-- le patch d'interface Encaissement/Reçu.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS finance.fee_schedule_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  fee_schedule_id uuid NOT NULL REFERENCES finance.fee_schedules(id) ON DELETE CASCADE,
  component_code text NOT NULL,
  label text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_schedule_components_unique_code UNIQUE (fee_schedule_id, component_code),
  CONSTRAINT fee_schedule_components_unique_label UNIQUE (fee_schedule_id, label)
);

CREATE INDEX IF NOT EXISTS fee_schedule_components_school_schedule_idx
  ON finance.fee_schedule_components (school_id, fee_schedule_id);

CREATE INDEX IF NOT EXISTS fee_schedule_components_active_idx
  ON finance.fee_schedule_components (fee_schedule_id, is_active, order_index);

CREATE TABLE IF NOT EXISTS finance.receipt_allocation_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_allocation_id uuid NOT NULL REFERENCES finance.receipt_allocations(id) ON DELETE CASCADE,
  fee_schedule_component_id uuid NOT NULL REFERENCES finance.fee_schedule_components(id) ON DELETE RESTRICT,
  label text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_allocation_components_unique_component UNIQUE (receipt_allocation_id, fee_schedule_component_id)
);

CREATE INDEX IF NOT EXISTS receipt_allocation_components_allocation_idx
  ON finance.receipt_allocation_components (receipt_allocation_id, order_index);

CREATE INDEX IF NOT EXISTS receipt_allocation_components_component_idx
  ON finance.receipt_allocation_components (fee_schedule_component_id);

CREATE OR REPLACE VIEW finance.v_receipt_allocation_components AS
SELECT
  rac.id,
  rac.receipt_allocation_id,
  rac.fee_schedule_component_id,
  rac.label,
  rac.amount,
  rac.order_index,
  rac.created_at,
  ra.receipt_id,
  ra.student_charge_id,
  r.school_id,
  r.academic_year_id,
  r.academic_year,
  r.student_id,
  r.receipt_status
FROM finance.receipt_allocation_components rac
JOIN finance.receipt_allocations ra
  ON ra.id = rac.receipt_allocation_id
JOIN finance.receipts r
  ON r.id = ra.receipt_id;

-- Droits de lecture utiles aux pages serveur authentifiées.
GRANT SELECT ON finance.fee_schedule_components TO authenticated;
GRANT SELECT ON finance.receipt_allocation_components TO authenticated;
GRANT SELECT ON finance.v_receipt_allocation_components TO authenticated;

-- ============================================================
-- Seed CSCA : détail des 230 000 F de frais annexes internat
-- pour tous les barèmes "Internat - Frais annexes internat"
-- de l'année 2026-2027.
-- ============================================================

WITH target_schedules AS (
  SELECT
    fs.id AS fee_schedule_id,
    fs.school_id,
    c.label AS class_label
  FROM finance.fee_schedules fs
  JOIN public.classes c
    ON c.id = fs.class_id
   AND c.institution_id = fs.school_id
  WHERE fs.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    AND fs.academic_year = '2026-2027'
    AND fs.label = 'Internat - Frais annexes internat'
    AND fs.is_active IS TRUE
),
components(component_code, label, amount, order_index) AS (
  VALUES
    ('kit_cahier', 'Kit Cahier', 28500::numeric, 1),
    ('breviaire', 'Bréviaire', 13000::numeric, 2),
    ('bible_africaine', 'Bible Africaine', 8500::numeric, 3),
    ('argent_poche_enfant', 'Argent de poche pour l’enfant', 25000::numeric, 4),
    ('entretien_toilettes_internat', 'Entretien des toilettes internat', 5000::numeric, 5),
    ('etudes_surveillees', 'Études surveillées', 40000::numeric, 6),
    ('convoi_internat', 'Convoi internat', 30000::numeric, 7),
    ('trousseau_fourni_internat', 'Trousseau fourni par l’internat', 65000::numeric, 8),
    ('autres_frais', 'Autres frais', 15000::numeric, 9)
),
upserted AS (
  INSERT INTO finance.fee_schedule_components (
    school_id,
    fee_schedule_id,
    component_code,
    label,
    amount,
    order_index,
    is_active
  )
  SELECT
    ts.school_id,
    ts.fee_schedule_id,
    c.component_code,
    c.label,
    c.amount,
    c.order_index,
    true
  FROM target_schedules ts
  CROSS JOIN components c
  ON CONFLICT (fee_schedule_id, component_code)
  DO UPDATE SET
    label = EXCLUDED.label,
    amount = EXCLUDED.amount,
    order_index = EXCLUDED.order_index,
    is_active = true,
    updated_at = now()
  RETURNING id
),
checks AS (
  SELECT
    ts.class_label,
    COUNT(fsc.id) AS composants,
    SUM(fsc.amount) AS total_composants
  FROM target_schedules ts
  LEFT JOIN finance.fee_schedule_components fsc
    ON fsc.fee_schedule_id = ts.fee_schedule_id
   AND fsc.is_active IS TRUE
  GROUP BY ts.class_label
)
SELECT
  'composants_frais_annexes_internat_ok' AS check_name,
  COUNT(*) AS classes_parametrees,
  SUM(composants) AS composants_actifs,
  MIN(total_composants) AS total_min_par_classe,
  MAX(total_composants) AS total_max_par_classe
FROM checks;

COMMIT;
