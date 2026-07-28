-- Révision monotone des données nécessaires à l'appel hors ligne.
-- La fonction est appelée par des triggers de la même transaction que la
-- mutation métier : une mutation annulée ne publie donc jamais de révision.

CREATE TABLE IF NOT EXISTS public.attendance_schedule_revisions (
  institution_id uuid PRIMARY KEY
    REFERENCES public.institutions(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attendance_schedule_revisions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.attendance_schedule_revisions(institution_id, revision)
SELECT id, 0
FROM public.institutions
ON CONFLICT (institution_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_institution_id uuid;
BEGIN
  scoped_institution_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.institution_id
    ELSE NEW.institution_id
  END;

  IF scoped_institution_id IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  INSERT INTO public.attendance_schedule_revisions(
    institution_id,
    revision,
    updated_at
  )
  VALUES (scoped_institution_id, 1, now())
  ON CONFLICT (institution_id) DO UPDATE
  SET revision = public.attendance_schedule_revisions.revision + 1,
      updated_at = excluded.updated_at;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision() FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision() FROM authenticated;

DO $$
DECLARE
  table_name text;
  trigger_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'institution_periods',
    'teacher_timetables',
    'class_teachers',
    'teacher_subjects',
    'institution_subjects',
    'classes',
    'profiles',
    'user_roles'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION
        'Table attendue absente pour la révision pédagogique: public.%',
        table_name;
    END IF;

    trigger_name := format('trg_%s_attendance_schedule_revision', table_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      trigger_name,
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I
       AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.bump_attendance_schedule_revision()',
      trigger_name,
      table_name
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE public.attendance_schedule_revisions IS
  'Révision monotone, partitionnée par établissement, du planning nécessaire à l’appel hors ligne.';
