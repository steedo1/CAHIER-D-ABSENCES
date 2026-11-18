-- Maîtres de classe du primaire (création sans discipline, horaire ou compte Auth).
-- L'affectation reste dans le seul établissement et la seule classe concernée.
CREATE TABLE IF NOT EXISTS public.primary_class_teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 160),
  account_profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT primary_class_teachers_one_per_class UNIQUE (institution_id,class_id)
);
CREATE INDEX IF NOT EXISTS primary_class_teachers_institution_idx
  ON public.primary_class_teachers(institution_id);
ALTER TABLE public.primary_class_teachers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.primary_class_teachers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.primary_class_teachers TO service_role;