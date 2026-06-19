-- Mon Cahier — Finance Dépenses
-- V2 : plusieurs budgets/enveloppes par établissement et par année scolaire.
-- Objectif : permettre Budget École, Budget Internat, Cantine, Travaux, Projet, etc.
-- Script idempotent : ne supprime aucune donnée existante.
-- À exécuter APRÈS sql/finance_expense_budgets_v1.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS finance;

-- 1) Table des budgets/enveloppes.
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

CREATE INDEX IF NOT EXISTS idx_expense_budgets_school_year
  ON finance.expense_budgets (school_id, academic_year, is_active);

-- 2) Rattachement des postes budgétaires à une enveloppe.
ALTER TABLE finance.expense_budget_lines
  ADD COLUMN IF NOT EXISTS budget_id uuid NULL REFERENCES finance.expense_budgets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_budget_lines_budget
  ON finance.expense_budget_lines (school_id, academic_year, budget_id, is_active);

-- 3) Rattachement direct possible d'une dépense à un budget, même sans poste précis.
ALTER TABLE finance.expenses
  ADD COLUMN IF NOT EXISTS budget_id uuid NULL REFERENCES finance.expense_budgets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_budget
  ON finance.expenses (school_id, budget_id, expense_status, expense_date);

-- 4) Migration des anciens postes : tout poste sans budget reçoit un budget par défaut.
-- Pour le CSCA 2026-2027 déjà importé, on nomme explicitement l'enveloppe "Budget École".
DO $$
DECLARE
  r record;
  v_budget_id uuid;
  v_budget_name text;
  v_budget_code text;
  v_description text;
BEGIN
  FOR r IN
    SELECT
      bl.school_id,
      bl.academic_year_id,
      bl.academic_year,
      i.name AS school_name,
      coalesce(i.code_unique, '') AS school_code
    FROM finance.expense_budget_lines bl
    JOIN public.institutions i ON i.id = bl.school_id
    WHERE bl.budget_id IS NULL
    GROUP BY bl.school_id, bl.academic_year_id, bl.academic_year, i.name, coalesce(i.code_unique, '')
  LOOP
    IF coalesce(r.school_code, '') = '000657'
       AND coalesce(r.academic_year, '') = '2026-2027' THEN
      v_budget_name := 'Budget École';
      v_budget_code := 'budget_ecole';
      v_description := 'Budget des dépenses école / cours secondaire CSCA 2026-2027.';
    ELSE
      v_budget_name := 'Budget général';
      v_budget_code := 'budget_general';
      v_description := 'Budget général créé automatiquement pour rattacher les postes existants.';
    END IF;

    SELECT eb.id
      INTO v_budget_id
    FROM finance.expense_budgets eb
    WHERE eb.school_id = r.school_id
      AND coalesce(eb.academic_year, '') = coalesce(r.academic_year, '')
      AND lower(eb.code) = lower(v_budget_code)
    LIMIT 1;

    IF v_budget_id IS NULL THEN
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
        r.school_id,
        r.academic_year_id,
        r.academic_year,
        v_budget_code,
        v_budget_name,
        v_description,
        true,
        now(),
        now()
      )
      RETURNING id INTO v_budget_id;
    END IF;

    UPDATE finance.expense_budget_lines bl
       SET budget_id = v_budget_id,
           updated_at = now()
     WHERE bl.school_id = r.school_id
       AND bl.budget_id IS NULL
       AND coalesce(bl.academic_year, '') = coalesce(r.academic_year, '');
  END LOOP;
END $$;

-- 5) Les dépenses déjà rattachées à un poste récupèrent automatiquement le budget du poste.
UPDATE finance.expenses e
   SET budget_id = bl.budget_id,
       updated_at = now()
  FROM finance.expense_budget_lines bl
 WHERE e.budget_line_id = bl.id
   AND e.budget_id IS NULL
   AND bl.budget_id IS NOT NULL;

COMMIT;

-- Contrôle rapide : budgets, postes et totaux par établissement/année.
SELECT
  i.name AS etablissement,
  i.code_unique,
  eb.academic_year,
  eb.name AS budget,
  eb.code,
  count(bl.id) AS nb_postes,
  coalesce(sum(bl.planned_amount), 0)::bigint AS total_prevu,
  eb.is_active
FROM finance.expense_budgets eb
JOIN public.institutions i ON i.id = eb.school_id
LEFT JOIN finance.expense_budget_lines bl ON bl.budget_id = eb.id
GROUP BY i.name, i.code_unique, eb.academic_year, eb.name, eb.code, eb.is_active
ORDER BY i.name, eb.academic_year, eb.name;
