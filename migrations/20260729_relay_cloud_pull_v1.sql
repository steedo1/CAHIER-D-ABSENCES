-- Mon Cahier — Lot 1B-A du mode hors ligne
-- Révision Cloud exhaustive des données nécessaires au relais autonome.
-- Le PC relais utilise cette révision pour demander un nouveau snapshot seulement
-- lorsqu'une donnée utile au fonctionnement hors ligne a réellement changé.

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
  old_institution_id uuid;
  new_institution_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_institution_id := NEW.institution_id;
  ELSIF TG_OP = 'DELETE' THEN
    old_institution_id := OLD.institution_id;
  ELSE
    old_institution_id := OLD.institution_id;
    new_institution_id := NEW.institution_id;
  END IF;

  IF old_institution_id IS NOT NULL THEN
    INSERT INTO public.attendance_schedule_revisions(
      institution_id,
      revision,
      updated_at
    )
    VALUES (old_institution_id, 1, now())
    ON CONFLICT (institution_id) DO UPDATE
    SET revision = public.attendance_schedule_revisions.revision + 1,
        updated_at = excluded.updated_at;
  END IF;

  IF new_institution_id IS NOT NULL
     AND new_institution_id IS DISTINCT FROM old_institution_id THEN
    INSERT INTO public.attendance_schedule_revisions(
      institution_id,
      revision,
      updated_at
    )
    VALUES (new_institution_id, 1, now())
    ON CONFLICT (institution_id) DO UPDATE
    SET revision = public.attendance_schedule_revisions.revision + 1,
        updated_at = excluded.updated_at;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision_for_institution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_institution_id uuid;
BEGIN
  scoped_institution_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.id
    ELSE NEW.id
  END;

  IF scoped_institution_id IS NOT NULL THEN
    INSERT INTO public.attendance_schedule_revisions(
      institution_id,
      revision,
      updated_at
    )
    VALUES (scoped_institution_id, 1, now())
    ON CONFLICT (institution_id) DO UPDATE
    SET revision = public.attendance_schedule_revisions.revision + 1,
        updated_at = excluded.updated_at;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_profile_id uuid;
  old_institution_id uuid;
  new_institution_id uuid;
  scoped_institution_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_profile_id := NEW.id;
    new_institution_id := NEW.institution_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_profile_id := OLD.id;
    old_institution_id := OLD.institution_id;
  ELSE
    target_profile_id := NEW.id;
    old_institution_id := OLD.institution_id;
    new_institution_id := NEW.institution_id;
  END IF;

  FOR scoped_institution_id IN
    SELECT DISTINCT candidate.institution_id
    FROM (
      SELECT old_institution_id AS institution_id
      UNION ALL
      SELECT new_institution_id
      UNION ALL
      SELECT institution_id FROM public.user_roles WHERE profile_id = target_profile_id
      UNION ALL
      SELECT institution_id FROM public.teacher_subjects WHERE profile_id = target_profile_id
      UNION ALL
      SELECT institution_id FROM public.class_teachers WHERE teacher_id = target_profile_id
      UNION ALL
      SELECT institution_id FROM public.teacher_timetables WHERE teacher_id = target_profile_id
      UNION ALL
      SELECT institution_id FROM public.teacher_absence_requests WHERE teacher_profile_id = target_profile_id
      UNION ALL
      SELECT institution_id FROM public.teacher_sessions WHERE teacher_id = target_profile_id
    ) AS candidate
    WHERE candidate.institution_id IS NOT NULL
  LOOP
    INSERT INTO public.attendance_schedule_revisions(
      institution_id,
      revision,
      updated_at
    )
    VALUES (scoped_institution_id, 1, now())
    ON CONFLICT (institution_id) DO UPDATE
    SET revision = public.attendance_schedule_revisions.revision + 1,
        updated_at = excluded.updated_at;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision_for_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_subject_id uuid;
  scoped_institution_id uuid;
BEGIN
  target_subject_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.id
    ELSE NEW.id
  END;

  FOR scoped_institution_id IN
    SELECT DISTINCT institution_id
    FROM public.institution_subjects
    WHERE subject_id = target_subject_id
      AND institution_id IS NOT NULL
  LOOP
    INSERT INTO public.attendance_schedule_revisions(
      institution_id,
      revision,
      updated_at
    )
    VALUES (scoped_institution_id, 1, now())
    ON CONFLICT (institution_id) DO UPDATE
    SET revision = public.attendance_schedule_revisions.revision + 1,
        updated_at = excluded.updated_at;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_for_institution() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_for_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_for_subject() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision() FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision() FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision_for_institution() FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision_for_institution() FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision_for_profile() FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision_for_profile() FROM authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision_for_subject() FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.bump_attendance_schedule_revision_for_subject() FROM authenticated;

DO $$
DECLARE
  table_name text;
  trigger_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'academic_years',
    'classes',
    'user_roles',
    'institution_subjects',
    'teacher_subjects',
    'class_teachers',
    'students',
    'class_enrollments',
    'institution_periods',
    'teacher_timetables',
    'teacher_absence_requests',
    'teacher_sessions'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION
        'Table attendue absente pour la synchronisation Cloud -> relais: public.%',
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

  FOREACH table_name IN ARRAY ARRAY[
    'institution_attendance_policies',
    'institution_attendance_zones'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
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

  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION
      'Table attendue absente pour la synchronisation Cloud -> relais: public.profiles';
  END IF;
  EXECUTE
    'DROP TRIGGER IF EXISTS trg_profiles_attendance_schedule_revision
       ON public.profiles';
  EXECUTE
    'CREATE TRIGGER trg_profiles_attendance_schedule_revision
       AFTER INSERT OR UPDATE OR DELETE
       ON public.profiles
       FOR EACH ROW
       EXECUTE FUNCTION public.bump_attendance_schedule_revision_for_profile()';

  IF to_regclass('public.subjects') IS NULL THEN
    RAISE EXCEPTION
      'Table attendue absente pour la synchronisation Cloud -> relais: public.subjects';
  END IF;
  EXECUTE
    'DROP TRIGGER IF EXISTS trg_subjects_attendance_schedule_revision
       ON public.subjects';
  EXECUTE
    'CREATE TRIGGER trg_subjects_attendance_schedule_revision
       AFTER INSERT OR UPDATE OR DELETE
       ON public.subjects
       FOR EACH ROW
       EXECUTE FUNCTION public.bump_attendance_schedule_revision_for_subject()';

  EXECUTE
    'DROP TRIGGER IF EXISTS trg_institutions_attendance_schedule_revision
       ON public.institutions';
  EXECUTE
    'CREATE TRIGGER trg_institutions_attendance_schedule_revision
       AFTER UPDATE OF name, code, code_unique, tz, settings_json
       ON public.institutions
       FOR EACH ROW
       EXECUTE FUNCTION public.bump_attendance_schedule_revision_for_institution()';
END;
$$;

COMMENT ON TABLE public.attendance_schedule_revisions IS
  'Révision monotone et exhaustive du snapshot pédagogique utilisé par le relais autonome.';
