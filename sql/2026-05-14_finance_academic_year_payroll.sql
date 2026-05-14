-- Mon Cahier — Gestion financière
-- Année scolaire + paie enseignants par séances, marges et minutes perdues
-- À exécuter AVANT de déployer les fichiers TSX ci-joints.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Lien explicite des runs de paie à l'année scolaire consultée.
ALTER TABLE finance.teacher_payroll_runs
  ADD COLUMN IF NOT EXISTS academic_year_id uuid NULL REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS academic_year text NULL,
  ADD COLUMN IF NOT EXISTS late_tolerance_min integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS early_departure_tolerance_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_reference_minutes integer NOT NULL DEFAULT 60;

CREATE INDEX IF NOT EXISTS idx_teacher_payroll_runs_school_year
  ON finance.teacher_payroll_runs (institution_id, academic_year, period_month);

-- 2) Montants théoriques et ajustés au niveau enseignant.
ALTER TABLE finance.teacher_payroll_lines
  ADD COLUMN IF NOT EXISTS expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_minutes_after_tolerance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_sessions_equivalent numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_amount numeric(12,2) NOT NULL DEFAULT 0;

-- On garde les anciens runs lisibles : si adjusted_amount était vide, il reprend gross_amount.
UPDATE finance.teacher_payroll_lines
SET
  expected_amount = COALESCE(NULLIF(expected_amount, 0), gross_amount, 0),
  adjusted_amount = COALESCE(NULLIF(adjusted_amount, 0), gross_amount, 0)
WHERE COALESCE(adjusted_amount, 0) = 0;

CREATE INDEX IF NOT EXISTS idx_teacher_payroll_lines_lost
  ON finance.teacher_payroll_lines (run_id, teacher_id);

-- 3) Détail par séance pour justifier la paie devant l'administration et l'enseignant.
ALTER TABLE finance.teacher_payroll_line_sessions
  ADD COLUMN IF NOT EXISTS tolerance_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_minutes_after_tolerance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_sessions_equivalent numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS theoretical_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lost_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_amount numeric(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_teacher_payroll_line_sessions_run_teacher_date
  ON finance.teacher_payroll_line_sessions (run_id, teacher_id, session_date);

COMMIT;
