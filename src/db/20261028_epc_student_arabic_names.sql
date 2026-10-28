-- Optional validated Arabic spelling of a student's name, shared by all
-- pedagogical tracks. The French civil identity and matricule remain canonical.
-- Additive / non-destructive: no data migration, no new student rows.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS full_name_ar text NULL;

COMMENT ON COLUMN public.students.full_name_ar IS
  'Optional Arabic spelling for Arabic teaching documents; official French identity unchanged.';
