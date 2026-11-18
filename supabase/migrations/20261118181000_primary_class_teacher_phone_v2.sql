-- Le numéro est facultatif lors de l'enregistrement d'un maître du primaire.
-- Il est requis uniquement lors de l'activation de son compte de connexion.
ALTER TABLE public.primary_class_teachers
  ADD COLUMN IF NOT EXISTS phone_e164 text;
ALTER TABLE public.primary_class_teachers
  ADD CONSTRAINT primary_class_teacher_phone_e164_format
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{5,14}$');
CREATE UNIQUE INDEX IF NOT EXISTS primary_class_teachers_unique_phone_per_school
  ON public.primary_class_teachers(institution_id,phone_e164)
  WHERE phone_e164 IS NOT NULL;
