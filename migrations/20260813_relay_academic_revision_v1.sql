-- Revision monotone, distincte du planning/appel, de toutes les sources du
-- snapshot academique Cloud -> relais.

BEGIN;

-- Les CREATE TRIGGER prennent des verrous sur les tables sources. En cas de
-- trafic concurrent, echouer proprement vaut mieux qu'attendre indefiniment.
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.academic_revisions (
  institution_id uuid PRIMARY KEY
    REFERENCES public.institutions(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.academic_revisions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.academic_revisions(institution_id, revision, updated_at)
SELECT institution.id,
       COALESCE(schedule.revision, 0),
       COALESCE(schedule.updated_at, now())
FROM public.institutions institution
LEFT JOIN public.attendance_schedule_revisions schedule
  ON schedule.institution_id = institution.id
ON CONFLICT (institution_id) DO NOTHING;

-- Point de serialisation commun aux deux compteurs du relais. Toute fonction
-- qui ecrit academic_revisions ou attendance_schedule_revisions doit prendre
-- ce verrou transactionnel avant de toucher le compteur. L'ordre des triggers
-- PostgreSQL n'est donc pas utilise comme mecanisme de synchronisation.
CREATE OR REPLACE FUNCTION public.lock_relay_revision_scope(scoped_institution_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF scoped_institution_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mon-cahier:relay-revision:' || scoped_institution_id::text, 0)
  );
END;
$$;

-- Conserve strictement la semantique du compteur planning/appel existant,
-- tout en lui faisant prendre le meme verrou de scope que le compteur
-- academique. Il n'y a aucune ecriture croisee entre les deux compteurs.
CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision_value(
  scoped_institution_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  revision_marker text;
BEGIN
  IF scoped_institution_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.lock_relay_revision_scope(scoped_institution_id);
  revision_marker := 'moncahier.attendance_schedule_revision_' ||
    replace(scoped_institution_id::text, '-', '');
  IF current_setting(revision_marker, true) = 'bumped' THEN
    RETURN;
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
  PERFORM set_config(revision_marker, 'bumped', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_institution_id uuid;
  new_institution_id uuid;
  scoped_institution_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_institution_id := OLD.institution_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_institution_id := NEW.institution_id; END IF;
  FOR scoped_institution_id IN
    SELECT DISTINCT candidate.institution_id
    FROM (VALUES (old_institution_id), (new_institution_id)) AS candidate(institution_id)
    WHERE candidate.institution_id IS NOT NULL
    ORDER BY candidate.institution_id
  LOOP
    PERFORM public.bump_attendance_schedule_revision_value(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision_for_institution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.bump_attendance_schedule_revision_value(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
  );
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
      UNION ALL SELECT new_institution_id
      UNION ALL SELECT institution_id FROM public.user_roles WHERE profile_id = target_profile_id
      UNION ALL SELECT institution_id FROM public.teacher_subjects WHERE profile_id = target_profile_id
      UNION ALL SELECT institution_id FROM public.class_teachers WHERE teacher_id = target_profile_id
      UNION ALL SELECT institution_id FROM public.teacher_timetables WHERE teacher_id = target_profile_id
      UNION ALL SELECT institution_id FROM public.teacher_absence_requests WHERE teacher_profile_id = target_profile_id
      UNION ALL SELECT institution_id FROM public.teacher_sessions WHERE teacher_id = target_profile_id
    ) AS candidate
    WHERE candidate.institution_id IS NOT NULL
    ORDER BY candidate.institution_id
  LOOP
    PERFORM public.bump_attendance_schedule_revision_value(scoped_institution_id);
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
  target_subject_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  FOR scoped_institution_id IN
    SELECT DISTINCT institution_id
    FROM public.institution_subjects
    WHERE subject_id = target_subject_id
      AND institution_id IS NOT NULL
    ORDER BY institution_id
  LOOP
    PERFORM public.bump_attendance_schedule_revision_value(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision_for_attendance_mark()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_institution_id uuid;
BEGIN
  FOR scoped_institution_id IN
    SELECT DISTINCT institution_id
    FROM public.teacher_sessions
    WHERE id IN (
      CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END,
      CASE WHEN TG_OP = 'INSERT' THEN NEW.session_id ELSE OLD.session_id END
    )
      AND institution_id IS NOT NULL
    ORDER BY institution_id
  LOOP
    PERFORM public.bump_attendance_schedule_revision_value(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision(scoped_institution_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  revision_marker text;
BEGIN
  IF scoped_institution_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.lock_relay_revision_scope(scoped_institution_id);
  revision_marker := 'moncahier.academic_revision_' ||
    replace(scoped_institution_id::text, '-', '');
  IF current_setting(revision_marker, true) = 'bumped' THEN
    RETURN;
  END IF;
  INSERT INTO public.academic_revisions(institution_id, revision, updated_at)
  VALUES (scoped_institution_id, 1, now())
  ON CONFLICT (institution_id) DO UPDATE
  SET revision = public.academic_revisions.revision + 1,
      updated_at = excluded.updated_at;
  PERFORM set_config(revision_marker, 'bumped', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_scoped_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_institution_id uuid;
  new_institution_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_institution_id := OLD.institution_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_institution_id := NEW.institution_id; END IF;
  FOR old_institution_id IN
    SELECT DISTINCT candidate.institution_id
    FROM (VALUES (old_institution_id), (new_institution_id)) AS candidate(institution_id)
    WHERE candidate.institution_id IS NOT NULL
    ORDER BY candidate.institution_id
  LOOP
    PERFORM public.bump_relay_academic_revision(old_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_institution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.bump_relay_academic_revision(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_profile_id uuid;
  new_profile_id uuid;
  old_institution_id uuid;
  new_institution_id uuid;
  scoped_institution_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_profile_id := OLD.id;
    old_institution_id := OLD.institution_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_profile_id := NEW.id;
    new_institution_id := NEW.institution_id;
  END IF;

  FOR scoped_institution_id IN
    SELECT DISTINCT candidate.institution_id
    FROM (
      SELECT old_institution_id AS institution_id
      UNION ALL SELECT new_institution_id
      UNION ALL SELECT institution_id FROM public.user_roles
        WHERE profile_id IN (old_profile_id, new_profile_id)
      UNION ALL SELECT institution_id FROM public.teacher_subjects
        WHERE profile_id IN (old_profile_id, new_profile_id)
      UNION ALL SELECT institution_id FROM public.class_teachers
        WHERE teacher_id IN (old_profile_id, new_profile_id)
      UNION ALL SELECT institution_id FROM public.educator_class_assignments
        WHERE profile_id IN (old_profile_id, new_profile_id)
      UNION ALL SELECT institution_id FROM public.teacher_timetables
        WHERE teacher_id IN (old_profile_id, new_profile_id)
      UNION ALL SELECT institution_id FROM public.teacher_absence_requests
        WHERE teacher_profile_id IN (old_profile_id, new_profile_id)
      UNION ALL SELECT institution_id FROM public.teacher_sessions
        WHERE teacher_id IN (old_profile_id, new_profile_id)
      UNION ALL
        SELECT DISTINCT c.institution_id
        FROM public.grade_evaluations e
        JOIN public.classes c ON c.id = e.class_id
        WHERE e.teacher_id IN (old_profile_id, new_profile_id)
      UNION ALL SELECT institution_id FROM public.teacher_signatures
        WHERE teacher_id IN (old_profile_id, new_profile_id)
      UNION ALL SELECT institution_id FROM public.student_penalties
        WHERE teacher_id IN (old_profile_id, new_profile_id)
    ) AS candidate
    WHERE candidate.institution_id IS NOT NULL
    ORDER BY candidate.institution_id
  LOOP
    PERFORM public.bump_relay_academic_revision(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_subject_id uuid;
  new_subject_id uuid;
  scoped_institution_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_subject_id := OLD.id; END IF;
  IF TG_OP <> 'DELETE' THEN new_subject_id := NEW.id; END IF;
  FOR scoped_institution_id IN
    SELECT DISTINCT institution_id
    FROM public.institution_subjects
    WHERE subject_id IN (old_subject_id, new_subject_id)
      AND institution_id IS NOT NULL
    ORDER BY institution_id
  LOOP
    PERFORM public.bump_relay_academic_revision(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_evaluation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_institution_id uuid;
BEGIN
  FOR scoped_institution_id IN
    SELECT DISTINCT c.institution_id
    FROM public.classes c
    WHERE c.id IN (
      CASE WHEN TG_OP = 'DELETE' THEN OLD.class_id ELSE NEW.class_id END,
      CASE WHEN TG_OP = 'INSERT' THEN NEW.class_id ELSE OLD.class_id END
    )
    ORDER BY c.institution_id
  LOOP
    PERFORM public.bump_relay_academic_revision(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_evaluation_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_institution_id uuid;
BEGIN
  FOR scoped_institution_id IN
    SELECT DISTINCT c.institution_id
    FROM public.grade_evaluations e
    JOIN public.classes c ON c.id = e.class_id
    WHERE e.id IN (
      CASE WHEN TG_OP = 'DELETE' THEN OLD.evaluation_id ELSE NEW.evaluation_id END,
      CASE WHEN TG_OP = 'INSERT' THEN NEW.evaluation_id ELSE OLD.evaluation_id END
    )
    ORDER BY c.institution_id
  LOOP
    PERFORM public.bump_relay_academic_revision(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_institution_id uuid;
BEGIN
  FOR scoped_institution_id IN
    SELECT DISTINCT institution_id
    FROM public.classes
    WHERE id IN (
      CASE WHEN TG_OP = 'DELETE' THEN OLD.class_id ELSE NEW.class_id END,
      CASE WHEN TG_OP = 'INSERT' THEN NEW.class_id ELSE OLD.class_id END
    )
    ORDER BY institution_id
  LOOP
    PERFORM public.bump_relay_academic_revision(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_bulletin_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_institution_id uuid;
BEGIN
  FOR scoped_institution_id IN
    SELECT DISTINCT institution_id
    FROM public.bulletin_subject_groups
    WHERE id IN (
      CASE WHEN TG_OP = 'DELETE' THEN OLD.group_id ELSE NEW.group_id END,
      CASE WHEN TG_OP = 'INSERT' THEN NEW.group_id ELSE OLD.group_id END
    )
    ORDER BY institution_id
  LOOP
    PERFORM public.bump_relay_academic_revision(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_core_weight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_institution_id uuid;
  new_institution_id uuid;
  scoped_institution_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_institution_id := OLD.institution_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_institution_id := NEW.institution_id; END IF;
  IF (TG_OP <> 'INSERT' AND old_institution_id IS NULL)
     OR (TG_OP <> 'DELETE' AND new_institution_id IS NULL) THEN
    FOR scoped_institution_id IN SELECT id FROM public.institutions ORDER BY id LOOP
      PERFORM public.bump_relay_academic_revision(scoped_institution_id);
    END LOOP;
  ELSE
    PERFORM public.bump_relay_academic_revision(old_institution_id);
    IF new_institution_id IS DISTINCT FROM old_institution_id THEN
      PERFORM public.bump_relay_academic_revision(new_institution_id);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON TABLE public.academic_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_relay_revision_scope(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_value(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_for_institution() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_for_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_for_subject() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_for_attendance_mark() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_scoped_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_institution() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_subject() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_evaluation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_evaluation_child() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_adjustment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_bulletin_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_relay_academic_revision_for_core_weight() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name text;
  trigger_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'academic_years',
    'user_roles',
    'classes',
    'institution_subjects',
    'teacher_subjects',
    'class_teachers',
    'educator_class_assignments',
    'students',
    'class_enrollments',
    'grade_periods',
    'institution_level_subjects',
    'institution_subject_coeffs',
    'institution_subject_grade_policies',
    'grade_subject_components',
    'grade_published_scores',
    'grade_evaluation_locks',
    'institution_grade_publication_settings',
    'bulletin_subject_groups',
    'bulletin_nc_overrides',
    'institution_conduct_policies',
    'conduct_settings',
    'conduct_events',
    'conduct_penalties',
    'student_penalties',
    'conduct_average_overrides',
    'conduct_rubric_overrides',
    'teacher_signatures'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Table du snapshot academique attendue absente: public.%', table_name;
    END IF;
    trigger_name := format('trg_%s_relay_academic_revision', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_scoped_row()',
      trigger_name,
      table_name
    );
  END LOOP;

  DROP TRIGGER IF EXISTS trg_institutions_relay_academic_revision ON public.institutions;
  CREATE TRIGGER trg_institutions_relay_academic_revision
    AFTER INSERT OR UPDATE OF
      name, code, code_unique, tz, settings_json, logo_url, phone, email,
      regional_direction, postal_address, status, head_name, head_title,
      country_name, country_motto, ministry_name, bulletin_signatures_enabled,
      country_emblem_url, acronym
    ON public.institutions
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_institution();

  DROP TRIGGER IF EXISTS trg_profiles_relay_academic_revision ON public.profiles;
  CREATE TRIGGER trg_profiles_relay_academic_revision
    BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_profile();

  DROP TRIGGER IF EXISTS trg_subjects_relay_academic_revision ON public.subjects;
  CREATE TRIGGER trg_subjects_relay_academic_revision
    BEFORE INSERT OR UPDATE OR DELETE ON public.subjects
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_subject();

  -- Les marques d'appel appartiennent au flux planning/appel, jamais au
  -- manifeste academique Notes/Bulletins.
  DROP TRIGGER IF EXISTS trg_attendance_marks_relay_academic_revision ON public.attendance_marks;
  DROP TRIGGER IF EXISTS trg_attendance_marks_attendance_schedule_revision ON public.attendance_marks;
  CREATE TRIGGER trg_attendance_marks_attendance_schedule_revision
    AFTER INSERT OR UPDATE OR DELETE ON public.attendance_marks
    FOR EACH ROW EXECUTE FUNCTION public.bump_attendance_schedule_revision_for_attendance_mark();

  DROP TRIGGER IF EXISTS trg_grade_evaluations_relay_academic_revision ON public.grade_evaluations;
  CREATE TRIGGER trg_grade_evaluations_relay_academic_revision
    AFTER INSERT OR UPDATE OR DELETE ON public.grade_evaluations
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_evaluation();

  DROP TRIGGER IF EXISTS trg_student_grades_relay_academic_revision ON public.student_grades;
  CREATE TRIGGER trg_student_grades_relay_academic_revision
    AFTER INSERT OR UPDATE OR DELETE ON public.student_grades
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_evaluation_child();

  DROP TRIGGER IF EXISTS trg_grade_publication_events_relay_academic_revision
    ON public.grade_publication_events;
  CREATE TRIGGER trg_grade_publication_events_relay_academic_revision
    AFTER INSERT OR UPDATE OR DELETE ON public.grade_publication_events
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_evaluation_child();

  DROP TRIGGER IF EXISTS trg_grade_adjustments_relay_academic_revision ON public.grade_adjustments;
  CREATE TRIGGER trg_grade_adjustments_relay_academic_revision
    AFTER INSERT OR UPDATE OR DELETE ON public.grade_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_adjustment();

  DROP TRIGGER IF EXISTS trg_bulletin_subject_group_items_relay_academic_revision
    ON public.bulletin_subject_group_items;
  CREATE TRIGGER trg_bulletin_subject_group_items_relay_academic_revision
    AFTER INSERT OR UPDATE OR DELETE ON public.bulletin_subject_group_items
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_bulletin_item();

  DROP TRIGGER IF EXISTS trg_core_subject_weights_relay_academic_revision
    ON public.core_subject_weights;
  CREATE TRIGGER trg_core_subject_weights_relay_academic_revision
    AFTER INSERT OR UPDATE OR DELETE ON public.core_subject_weights
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_academic_revision_for_core_weight();
END;
$$;

COMMENT ON TABLE public.academic_revisions IS
  'Revision monotone du snapshot academique complet, distincte de la revision du planning/appel.';

COMMIT;
