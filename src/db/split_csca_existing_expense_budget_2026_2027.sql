-- Mon Cahier — CSCA 2026-2027
-- Répartition des 72 postes budgétaires déjà importés entre plusieurs enveloppes.
-- Objectif : ne rien dupliquer, ne rien supprimer, mais rattacher les postes au bon budget.
-- À exécuter après la mise en place du module multi-budgets.
-- Script idempotent : il peut être relancé sans créer de doublons.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS finance;

-- Sécurité minimale : si le script multi-budgets n'a pas encore été exécuté,
-- on crée/ajoute les objets nécessaires sans supprimer de données.
CREATE TABLE IF NOT EXISTS finance.expense_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year_id uuid NULL REFERENCES public.academic_years(id) ON DELETE SET NULL,
  academic_year text NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance.expense_budgets
  ADD COLUMN IF NOT EXISTS academic_year_id uuid NULL REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS academic_year text NULL,
  ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT 'budget_general',
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Budget général',
  ADD COLUMN IF NOT EXISTS description text NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_budgets_school_year_code
  ON finance.expense_budgets (school_id, coalesce(academic_year, ''), lower(code));

ALTER TABLE finance.expense_budget_lines
  ADD COLUMN IF NOT EXISTS budget_id uuid NULL REFERENCES finance.expense_budgets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_budget_lines_budget
  ON finance.expense_budget_lines (school_id, academic_year, budget_id, is_active);

ALTER TABLE finance.expenses
  ADD COLUMN IF NOT EXISTS budget_id uuid NULL REFERENCES finance.expense_budgets(id) ON DELETE SET NULL;

DO $$
DECLARE
  v_school_id uuid;
  v_academic_year_id uuid;
  v_year text := '2026-2027';
  v_cours_budget_id uuid;
  v_seminaire_budget_id uuid;
  v_total_found integer := 0;
  v_cours_count integer := 0;
  v_seminaire_count integer := 0;
BEGIN
  SELECT i.id
    INTO v_school_id
  FROM public.institutions i
  WHERE coalesce(i.code_unique, '') = '000657'
     OR upper(coalesce(i.name, '')) LIKE '%COURS SECONDAIRE CATHOLIQUE%ABOISSO%'
  ORDER BY CASE WHEN coalesce(i.code_unique, '') = '000657' THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'CSCA introuvable : aucun établissement avec code_unique 000657 ou nom COURS SECONDAIRE CATHOLIQUE ABOISSO.';
  END IF;

  SELECT ay.id
    INTO v_academic_year_id
  FROM public.academic_years ay
  WHERE ay.institution_id = v_school_id
    AND (
      coalesce(ay.code, '') = v_year
      OR coalesce(ay.label, '') = v_year
      OR concat(coalesce(ay.start_year::text, ''), '-', coalesce(ay.end_year::text, '')) = v_year
    )
  LIMIT 1;

  -- Budget Cours secondaire
  INSERT INTO finance.expense_budgets (
    school_id,
    academic_year_id,
    academic_year,
    code,
    name,
    description,
    is_active,
    created_at,
    updated_at
  ) VALUES (
    v_school_id,
    v_academic_year_id,
    v_year,
    'budget_cours_secondaire',
    'Budget Cours secondaire',
    'Enveloppe des dépenses du Cours secondaire CSCA pour l''année scolaire 2026-2027.',
    true,
    now(),
    now()
  )
  ON CONFLICT (school_id, coalesce(academic_year, ''), lower(code)) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        academic_year_id = coalesce(finance.expense_budgets.academic_year_id, EXCLUDED.academic_year_id),
        is_active = true,
        updated_at = now()
  RETURNING id INTO v_cours_budget_id;

  -- Budget Petit Séminaire
  INSERT INTO finance.expense_budgets (
    school_id,
    academic_year_id,
    academic_year,
    code,
    name,
    description,
    is_active,
    created_at,
    updated_at
  ) VALUES (
    v_school_id,
    v_academic_year_id,
    v_year,
    'budget_petit_seminaire',
    'Budget Petit Séminaire',
    'Enveloppe des dépenses du Petit Séminaire CSCA pour l''année scolaire 2026-2027.',
    true,
    now(),
    now()
  )
  ON CONFLICT (school_id, coalesce(academic_year, ''), lower(code)) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        academic_year_id = coalesce(finance.expense_budgets.academic_year_id, EXCLUDED.academic_year_id),
        is_active = true,
        updated_at = now()
  RETURNING id INTO v_seminaire_budget_id;

  CREATE TEMP TABLE IF NOT EXISTS _csca_budget_split_targets (
    line_id uuid PRIMARY KEY,
    target_budget text NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE _csca_budget_split_targets;

  -- Postes existants à rattacher au Budget Cours secondaire.
  INSERT INTO _csca_budget_split_targets (line_id, target_budget) VALUES
    ('3b4158ba-03cf-4e72-80e6-99ee8a946584', 'cours'),
    ('ae0ee939-2abd-4600-adc2-20f84cdaa243', 'cours'),
    ('15de7e84-db1b-4e43-98b0-8709b03be372', 'cours'),
    ('e2295ce4-948c-49e3-841e-3b86388140ba', 'cours'),
    ('71b98ae1-99ea-4321-8099-428c3e5978cd', 'cours'),
    ('b9f3b6e4-ed00-46af-af0c-fa775de9ccb5', 'cours'),
    ('29b2f684-2910-4096-8f19-e1afcce00473', 'cours'),
    ('18ef265c-0798-4a25-ab85-fc2d233e0789', 'cours'),
    ('44abc7f7-b0cf-4a12-a4a8-2c2704289d2a', 'cours'),
    ('4687d450-89fb-42b6-a732-8214ef0dcb7d', 'cours'),
    ('400c7956-d191-45a0-97a1-84c3ccd54414', 'cours'),
    ('1599d274-248a-4030-9412-93679482e6e4', 'cours'),
    ('a1075376-263b-4b6d-98dc-61cafbc07148', 'cours'),
    ('459ed1cd-ac90-41a2-a9c2-c000d3d264f4', 'cours'),
    ('feb84806-5bb2-4a99-b89a-bd08ba634bbd', 'cours'),
    ('b7501d4d-c064-43e9-b7a5-3b277f5d8a40', 'cours'),
    ('232cab23-e4bb-48d9-b38b-e793ace996e5', 'cours'),
    ('f1f0aa9c-b3c3-4ee7-acc8-07f2d3252bd1', 'cours'),
    ('78146529-e4c6-403f-8a55-a572a645a7c5', 'cours'),
    ('d15ded71-acd6-4fa0-ab75-1ba6967fba2b', 'cours'),
    ('579018d7-7d5b-4e4b-9ba8-720cba5d56c8', 'cours'),
    ('bc7e7f84-9895-4177-8b7f-21f3f433f48e', 'cours'),
    ('dfefdaf6-a1c4-4d47-938f-75eb69822275', 'cours'),
    ('7bbd4ef7-dfd5-4d8c-bbff-5fffbc64a636', 'cours'),
    ('fe4b84e1-0562-4e82-a172-4eefd455f5e3', 'cours'),
    ('48634e65-f85f-441b-839f-15b2f976a7b5', 'cours'),
    ('97304c1f-467f-4490-95ac-ebd0816c1b94', 'cours'),
    ('18180cdd-640f-4358-9b17-8264714cd7f0', 'cours'),
    ('48955e93-4e0c-4466-a326-ac172d8c6b2c', 'cours'),
    ('80c9deed-83ae-45bf-9abe-b3999cfbccb6', 'cours'),
    ('0d16657c-492a-4325-9b55-69d1b4f9d18c', 'cours'),
    ('507e00d2-d970-42b1-87e8-e2fe31c62027', 'cours'),
    ('8f8422cf-b787-48f0-b4a5-45d644201aff', 'cours'),
    ('87ca8ef8-fab8-40af-a205-227e23842a59', 'cours'),
    ('d0a084cd-aba4-4ae7-af0e-f4cef3e3ea2c', 'cours'),
    ('30eacec7-dc25-4d67-89d6-5dedc61162d4', 'cours'),
    ('bc8f1bf1-0cc6-4d07-a5aa-7676a28254a4', 'cours'),
    ('1aa294d3-c062-4eb5-9c5e-2830d05e257d', 'cours'),
    ('c141c725-ff9f-4d74-9acc-fd1bc9331abb', 'cours'),
    ('1ce6bdae-fbc0-43e3-bc62-0eb291df6c44', 'cours'),
    ('fc897fb5-8d91-4e85-80b9-f12b607d8bb3', 'cours'),
    ('d9dded82-b2bd-4226-a086-065cd3d52dd9', 'cours'),
    ('6a57227b-6d79-4d49-a509-1676759a636c', 'cours'),
    ('55ab4635-9766-423c-8c96-009dea46b2c2', 'cours'),
    ('c467fce0-0c46-493e-8732-4f5358e96db4', 'cours'),
    ('28e4142e-65e3-4609-9d41-4a73153518f2', 'cours'),
    ('93f42f53-59de-4445-84e5-827c13a322e6', 'cours'),
    ('eb03c047-ff2e-4254-b000-cf07a28016b6', 'cours'),
    ('909a666a-b34e-4969-b6da-6de03d40fd34', 'cours'),
    ('49da5c72-9477-498e-8c0d-5ef9bd38715d', 'cours'),

    -- Postes existants à rattacher au Budget Petit Séminaire.
    ('19f1fd7c-9b55-439e-9314-359c4f9c765a', 'seminaire'),
    ('647f642a-84bf-4cb9-96fe-70b0a5e943d3', 'seminaire'),
    ('9c2f2898-5966-4a6d-bb7d-bb65b55a8c9f', 'seminaire'),
    ('9c1be4ac-6f44-40cb-8cbf-2223b3a32bd6', 'seminaire'),
    ('95e863aa-aff7-4b6a-af2f-0bc58870f317', 'seminaire'),
    ('7deacffd-915b-44fe-ad27-5ff720cfb14c', 'seminaire'),
    ('430de740-f06c-42f1-a017-ea688b6d97f0', 'seminaire'),
    ('44b00da3-3a1a-45f7-8ad3-e9526abcb453', 'seminaire'),
    ('2e0c2789-04eb-4379-9786-9179900b198b', 'seminaire'),
    ('29a6c092-e867-4706-936e-e761a724b655', 'seminaire'),
    ('6a6874bc-4a59-4dbd-a1c3-d54c61dac7f5', 'seminaire'),
    ('51f346c4-2d96-48a9-91bf-a30a593f7aaa', 'seminaire'),
    ('aacd2fa5-68a3-4511-b353-25ad0e82d20d', 'seminaire'),
    ('77bb370c-9ba8-4129-bf8e-290aafdde793', 'seminaire'),
    ('dd6b54e0-ca48-4e66-9d31-3eda8634692b', 'seminaire'),
    ('c2f702b1-d137-41bc-a661-dd82fe230a2d', 'seminaire'),
    ('b30ede34-a74b-455e-841a-10cf774a9a91', 'seminaire'),
    ('41a88044-df09-43ea-93c5-265a303f5af8', 'seminaire'),
    ('9eedd621-f18c-4c82-97ed-1776a0ed0efd', 'seminaire'),
    ('b650dde7-4c5d-46dd-972f-6ff705d27179', 'seminaire'),
    ('804031aa-c37a-477a-850f-a0825c9ed266', 'seminaire'),
    ('00c08d0d-f26d-4c32-98c5-9bce7e336a03', 'seminaire')
  ON CONFLICT (line_id) DO UPDATE SET target_budget = EXCLUDED.target_budget;

  SELECT count(*)
    INTO v_total_found
  FROM finance.expense_budget_lines bl
  JOIN _csca_budget_split_targets t ON t.line_id = bl.id
  WHERE bl.school_id = v_school_id
    AND coalesce(bl.academic_year, '') = v_year;

  IF v_total_found < 60 THEN
    RAISE EXCEPTION 'Sécurité : seulement % postes reconnus sur les 72 attendus. Suppression/migration annulée.', v_total_found;
  END IF;

  UPDATE finance.expense_budget_lines bl
     SET budget_id = v_cours_budget_id,
         updated_at = now()
    FROM _csca_budget_split_targets t
   WHERE t.line_id = bl.id
     AND t.target_budget = 'cours'
     AND bl.school_id = v_school_id
     AND coalesce(bl.academic_year, '') = v_year;

  GET DIAGNOSTICS v_cours_count = ROW_COUNT;

  UPDATE finance.expense_budget_lines bl
     SET budget_id = v_seminaire_budget_id,
         updated_at = now()
    FROM _csca_budget_split_targets t
   WHERE t.line_id = bl.id
     AND t.target_budget = 'seminaire'
     AND bl.school_id = v_school_id
     AND coalesce(bl.academic_year, '') = v_year;

  GET DIAGNOSTICS v_seminaire_count = ROW_COUNT;

  -- Les dépenses déjà rattachées à ces postes reprennent l'enveloppe du poste.
  UPDATE finance.expenses e
     SET budget_id = bl.budget_id,
         updated_at = now()
    FROM finance.expense_budget_lines bl
    JOIN _csca_budget_split_targets t ON t.line_id = bl.id
   WHERE e.budget_line_id = bl.id
     AND bl.school_id = v_school_id
     AND coalesce(bl.academic_year, '') = v_year;

  -- Désactive l'ancien Budget École/Budget général uniquement s'il ne contient plus rien.
  UPDATE finance.expense_budgets eb
     SET is_active = false,
         updated_at = now(),
         description = coalesce(eb.description, '') || ' | Désactivé automatiquement après répartition CSCA en Budget Cours secondaire et Budget Petit Séminaire.'
   WHERE eb.school_id = v_school_id
     AND coalesce(eb.academic_year, '') = v_year
     AND lower(eb.code) IN ('budget_ecole', 'budget_general')
     AND NOT EXISTS (
       SELECT 1 FROM finance.expense_budget_lines bl WHERE bl.budget_id = eb.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM finance.expenses e WHERE e.budget_id = eb.id
     );

  RAISE NOTICE 'Répartition terminée : % postes Cours secondaire, % postes Petit Séminaire.', v_cours_count, v_seminaire_count;
END $$;

COMMIT;

-- Contrôle final : les postes sont maintenant séparés par enveloppe budgétaire.
SELECT
  i.name AS etablissement,
  i.code_unique,
  eb.academic_year,
  eb.name AS budget,
  eb.code,
  count(bl.id) AS nb_postes,
  coalesce(sum(bl.planned_amount), 0)::bigint AS total_budget,
  eb.is_active
FROM finance.expense_budgets eb
JOIN public.institutions i ON i.id = eb.school_id
LEFT JOIN finance.expense_budget_lines bl ON bl.budget_id = eb.id
WHERE i.code_unique = '000657'
  AND eb.academic_year = '2026-2027'
GROUP BY i.name, i.code_unique, eb.academic_year, eb.name, eb.code, eb.is_active
ORDER BY eb.name;

-- Contrôle des doublons restants : ils sont normaux s'ils sont dans deux budgets différents.
SELECT
  bl.account_no,
  bl.label,
  count(*) AS nb,
  string_agg(eb.name || ' : ' || bl.planned_amount::bigint::text || ' F', ' | ' ORDER BY eb.name) AS repartition
FROM finance.expense_budget_lines bl
JOIN finance.expense_budgets eb ON eb.id = bl.budget_id
JOIN public.institutions i ON i.id = bl.school_id
WHERE i.code_unique = '000657'
  AND bl.academic_year = '2026-2027'
GROUP BY bl.account_no, bl.label
HAVING count(*) > 1
ORDER BY bl.account_no, bl.label;
