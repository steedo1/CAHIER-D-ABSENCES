BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.conduct_rubric_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  academic_year text NOT NULL,
  period_code text NOT NULL,

  rubric_key text NOT NULL,

  from_date date NULL,
  to_date date NULL,

  calculated_value numeric(6,2) NOT NULL DEFAULT 0,
  override_value numeric(6,2) NOT NULL,

  edited_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conduct_rubric_overrides_rubric_key_check
    CHECK (rubric_key IN ('assiduite', 'tenue', 'moralite', 'discipline')),

  CONSTRAINT conduct_rubric_overrides_values_check
    CHECK (
      calculated_value >= 0 AND calculated_value <= 100
      AND override_value >= 0 AND override_value <= 100
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS conduct_rubric_overrides_unique_period_rubric
ON public.conduct_rubric_overrides (
  institution_id,
  class_id,
  student_id,
  academic_year,
  period_code,
  rubric_key
);

CREATE INDEX IF NOT EXISTS conduct_rubric_overrides_lookup_idx
ON public.conduct_rubric_overrides (
  institution_id,
  class_id,
  academic_year,
  period_code
);

CREATE INDEX IF NOT EXISTS conduct_rubric_overrides_student_idx
ON public.conduct_rubric_overrides (
  institution_id,
  student_id,
  academic_year,
  period_code
);

ALTER TABLE public.conduct_rubric_overrides ENABLE ROW LEVEL SECURITY;

COMMIT;
