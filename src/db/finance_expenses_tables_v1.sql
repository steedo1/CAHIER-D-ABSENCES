-- src/db/finance_expenses_tables_v1.sql
-- Prépare les tables de dépenses si elles n’existent pas encore.
-- Script idempotent : il ne supprime aucune donnée.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS finance;

DO $$
BEGIN
  CREATE TYPE finance.expense_status AS ENUM ('posted', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS finance.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance.expense_categories
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_school_code_uidx
  ON finance.expense_categories (school_id, code);

CREATE TABLE IF NOT EXISTS finance.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  category_id uuid REFERENCES finance.expense_categories(id) ON DELETE SET NULL,
  expense_status finance.expense_status NOT NULL DEFAULT 'posted',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  label text NOT NULL,
  beneficiary text,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance.expenses
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES finance.expense_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expense_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS beneficiary text,
  ADD COLUMN IF NOT EXISTS amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS expenses_school_date_idx
  ON finance.expenses (school_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS expenses_school_status_idx
  ON finance.expenses (school_id, expense_status);

CREATE INDEX IF NOT EXISTS expenses_category_idx
  ON finance.expenses (category_id);

COMMIT;

SELECT
  to_regclass('finance.expense_categories') AS expense_categories,
  to_regclass('finance.expenses') AS expenses;
