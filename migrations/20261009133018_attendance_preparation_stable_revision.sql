-- Compteur stable pour le planning/élèves préparés. La révision historique
-- conserve TOUS les changements d'appel et son protocole relais inchangé.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_schedule_revisions'
      AND column_name = 'preparation_revision'
  ) THEN
    ALTER TABLE public.attendance_schedule_revisions
      ADD COLUMN preparation_revision bigint NOT NULL DEFAULT 0
      CHECK (preparation_revision >= 0);
    UPDATE public.attendance_schedule_revisions SET preparation_revision = revision;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_preparation_revision_value(scoped_institution_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE revision_marker text;
BEGIN
  IF scoped_institution_id IS NULL THEN RETURN; END IF;
  PERFORM public.lock_relay_revision_scope(scoped_institution_id);
  revision_marker := 'moncahier.attendance_preparation_revision_' ||
    replace(scoped_institution_id::text, '-', '');
  IF current_setting(revision_marker, true) = 'bumped' THEN RETURN; END IF;
  INSERT INTO public.attendance_schedule_revisions(institution_id, revision, preparation_revision)
  VALUES (scoped_institution_id, 0, 1)
  ON CONFLICT (institution_id) DO UPDATE
  SET preparation_revision = public.attendance_schedule_revisions.preparation_revision + 1;
  PERFORM set_config(revision_marker, 'bumped', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_live_revision_value(scoped_institution_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE revision_marker text;
BEGIN
  IF scoped_institution_id IS NULL THEN RETURN; END IF;
  PERFORM public.lock_relay_revision_scope(scoped_institution_id);
  revision_marker := 'moncahier.attendance_schedule_revision_' ||
    replace(scoped_institution_id::text, '-', '');
  IF current_setting(revision_marker, true) = 'bumped' THEN RETURN; END IF;
  INSERT INTO public.attendance_schedule_revisions(institution_id, revision, updated_at)
  VALUES (scoped_institution_id, 1, now())
  ON CONFLICT (institution_id) DO UPDATE
  SET revision = public.attendance_schedule_revisions.revision + 1,
      updated_at = excluded.updated_at;
  PERFORM set_config(revision_marker, 'bumped', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision_value(scoped_institution_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.bump_attendance_preparation_revision_value(scoped_institution_id);
  PERFORM public.bump_attendance_live_revision_value(scoped_institution_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_live_revision_for_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_institution_id uuid; new_institution_id uuid; scoped_institution_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_institution_id := OLD.institution_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_institution_id := NEW.institution_id; END IF;
  FOR scoped_institution_id IN
    SELECT DISTINCT candidate.institution_id
    FROM (VALUES (old_institution_id), (new_institution_id)) AS candidate(institution_id)
    WHERE candidate.institution_id IS NOT NULL ORDER BY candidate.institution_id
  LOOP
    PERFORM public.bump_attendance_live_revision_value(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_attendance_schedule_revision_for_attendance_mark()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE scoped_institution_id uuid;
BEGIN
  FOR scoped_institution_id IN
    SELECT DISTINCT institution_id FROM public.teacher_sessions
    WHERE id IN (
      CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END,
      CASE WHEN TG_OP = 'INSERT' THEN NEW.session_id ELSE OLD.session_id END
    ) AND institution_id IS NOT NULL ORDER BY institution_id
  LOOP
    PERFORM public.bump_attendance_live_revision_value(scoped_institution_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_teacher_sessions_attendance_schedule_revision ON public.teacher_sessions;
CREATE TRIGGER trg_teacher_sessions_attendance_schedule_revision
AFTER INSERT OR UPDATE OR DELETE ON public.teacher_sessions
FOR EACH ROW EXECUTE FUNCTION public.bump_attendance_live_revision_for_session();
-- Conserve le nom et le contrat de l'ancien trigger.
DROP TRIGGER IF EXISTS trg_attendance_marks_attendance_schedule_revision ON public.attendance_marks;
CREATE TRIGGER trg_attendance_marks_attendance_schedule_revision
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_marks
FOR EACH ROW EXECUTE FUNCTION public.bump_attendance_schedule_revision_for_attendance_mark();

REVOKE ALL ON FUNCTION public.bump_attendance_preparation_revision_value(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_live_revision_value(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_live_revision_for_session() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_value(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_attendance_schedule_revision_for_attendance_mark() FROM PUBLIC, anon, authenticated;
COMMENT ON COLUMN public.attendance_schedule_revisions.preparation_revision IS
  'Révision du planning, des élèves et des accès; les appels reçus font évoluer uniquement la révision historique du relais.';
