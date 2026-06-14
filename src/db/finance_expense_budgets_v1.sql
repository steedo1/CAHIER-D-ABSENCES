-- src/db/finance_expense_budgets_v1.sql
-- Module Finance — Budget des dépenses + dépenses libres.
-- Script idempotent : ne supprime aucune donnée existante.
-- À exécuter dans Supabase SQL Editor avant de déployer la page Dépenses.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS finance;

CREATE TABLE IF NOT EXISTS finance.expense_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year_id uuid NULL REFERENCES public.academic_years(id) ON DELETE SET NULL,
  academic_year text NULL,
  category_id uuid NULL REFERENCES finance.expense_categories(id) ON DELETE SET NULL,
  account_no text NULL,
  label text NOT NULL,
  planned_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (planned_amount >= 0),
  notes text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance.expense_budget_lines
  ADD COLUMN IF NOT EXISTS academic_year_id uuid NULL REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS academic_year text NULL,
  ADD COLUMN IF NOT EXISTS category_id uuid NULL REFERENCES finance.expense_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_no text NULL,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS planned_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE finance.expenses
  ADD COLUMN IF NOT EXISTS budget_line_id uuid NULL REFERENCES finance.expense_budget_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS academic_year_id uuid NULL REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS academic_year text NULL,
  ADD COLUMN IF NOT EXISTS payment_method text NULL,
  ADD COLUMN IF NOT EXISTS reference_no text NULL;

CREATE INDEX IF NOT EXISTS expense_budget_lines_school_year_idx
  ON finance.expense_budget_lines (school_id, academic_year, is_active);

CREATE INDEX IF NOT EXISTS expense_budget_lines_school_account_idx
  ON finance.expense_budget_lines (school_id, account_no);

CREATE INDEX IF NOT EXISTS expense_budget_lines_category_idx
  ON finance.expense_budget_lines (category_id);

CREATE INDEX IF NOT EXISTS expenses_budget_line_idx
  ON finance.expenses (budget_line_id);

CREATE INDEX IF NOT EXISTS expenses_school_academic_year_idx
  ON finance.expenses (school_id, academic_year);

CREATE OR REPLACE FUNCTION finance.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_budget_lines_updated_at') THEN
    CREATE TRIGGER trg_expense_budget_lines_updated_at
    BEFORE UPDATE ON finance.expense_budget_lines
    FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expenses_updated_at') THEN
    CREATE TRIGGER trg_expenses_updated_at
    BEFORE UPDATE ON finance.expenses
    FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_categories_updated_at') THEN
    CREATE TRIGGER trg_expense_categories_updated_at
    BEFORE UPDATE ON finance.expense_categories
    FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();
  END IF;
END $$;

CREATE OR REPLACE VIEW finance.v_expense_budget_execution AS
SELECT
  bl.id,
  bl.school_id,
  bl.academic_year_id,
  bl.academic_year,
  bl.category_id,
  bl.account_no,
  bl.label,
  bl.planned_amount,
  bl.is_active,
  bl.notes,
  bl.created_at,
  bl.updated_at,
  COALESCE(SUM(e.amount) FILTER (WHERE e.expense_status = 'posted'), 0)::numeric(14,2) AS spent_amount,
  (bl.planned_amount - COALESCE(SUM(e.amount) FILTER (WHERE e.expense_status = 'posted'), 0))::numeric(14,2) AS remaining_amount,
  CASE
    WHEN bl.planned_amount > 0 THEN ROUND((COALESCE(SUM(e.amount) FILTER (WHERE e.expense_status = 'posted'), 0) / bl.planned_amount) * 100, 2)
    ELSE 0
  END::numeric(10,2) AS execution_rate
FROM finance.expense_budget_lines bl
LEFT JOIN finance.expenses e
  ON e.budget_line_id = bl.id
 AND e.school_id = bl.school_id
GROUP BY
  bl.id,
  bl.school_id,
  bl.academic_year_id,
  bl.academic_year,
  bl.category_id,
  bl.account_no,
  bl.label,
  bl.planned_amount,
  bl.is_active,
  bl.notes,
  bl.created_at,
  bl.updated_at;

COMMENT ON TABLE finance.expense_budget_lines IS
  'Postes budgétaires prévisionnels de dépenses par établissement et année scolaire.';
COMMENT ON COLUMN finance.expenses.budget_line_id IS
  'Lien facultatif vers un poste budgétaire. NULL = dépense libre / hors budget.';
COMMENT ON VIEW finance.v_expense_budget_execution IS
  'Synthèse budget prévu, dépensé, disponible et taux d’exécution par poste budgétaire.';

COMMIT;

SELECT
  to_regclass('finance.expense_budget_lines') AS expense_budget_lines,
  to_regclass('finance.v_expense_budget_execution') AS budget_execution_view;
