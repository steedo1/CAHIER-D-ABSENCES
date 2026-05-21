-- Mon Cahier - Affectation des éducateurs par niveau / classe
-- Règle métier :
-- - class_id IS NULL  => l'éducateur suit tout le niveau indiqué.
-- - class_id NOT NULL => l'éducateur suit uniquement cette classe.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.educator_class_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level text NOT NULL,
  class_id uuid NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_educator_class_assignments_institution_level
  ON public.educator_class_assignments (institution_id, level);

CREATE INDEX IF NOT EXISTS idx_educator_class_assignments_class
  ON public.educator_class_assignments (class_id)
  WHERE class_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_educator_class_assignments_profile
  ON public.educator_class_assignments (profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_educator_class_assignments_whole_level
  ON public.educator_class_assignments (institution_id, profile_id, level)
  WHERE class_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_educator_class_assignments_one_class
  ON public.educator_class_assignments (institution_id, profile_id, class_id)
  WHERE class_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_educator_class_assignments_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_educator_class_assignments_updated_at
ON public.educator_class_assignments;

CREATE TRIGGER trg_touch_educator_class_assignments_updated_at
BEFORE UPDATE ON public.educator_class_assignments
FOR EACH ROW
EXECUTE FUNCTION public.touch_educator_class_assignments_updated_at();
