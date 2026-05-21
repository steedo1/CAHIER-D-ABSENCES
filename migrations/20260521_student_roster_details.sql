-- 20260521_student_roster_details.sql
-- Compléments imprimables pour les listes de classe : LV2, sexe, redoublant, nationalité, naissance.
-- Cette table est indépendante de public.students pour ne pas casser les autres modules.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.student_roster_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  gender text NULL,
  birthdate date NULL,
  birth_place text NULL,
  nationality text NULL,
  is_repeater boolean NULL,
  lv2 text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_roster_details_unique UNIQUE (institution_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_roster_details_institution
  ON public.student_roster_details(institution_id);

CREATE INDEX IF NOT EXISTS idx_student_roster_details_student
  ON public.student_roster_details(student_id);

CREATE OR REPLACE FUNCTION public.set_student_roster_details_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_roster_details_updated_at ON public.student_roster_details;
CREATE TRIGGER trg_student_roster_details_updated_at
BEFORE UPDATE ON public.student_roster_details
FOR EACH ROW
EXECUTE FUNCTION public.set_student_roster_details_updated_at();
