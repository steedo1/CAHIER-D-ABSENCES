-- Aucun changement des séances existantes, des affectations ou de l'EDT.
-- Le verrou transactionnel ferme la course entre le contrôle HTTP et INSERT.
CREATE OR REPLACE FUNCTION public.guard_exceptional_class_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.class_id IS NULL OR NEW.status <> 'open' OR NEW.ended_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.institution_id::text || '/' || NEW.class_id::text, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.teacher_sessions s
    WHERE s.institution_id = NEW.institution_id AND s.class_id = NEW.class_id
      AND s.status = 'open' AND s.ended_at IS NULL AND s.id <> NEW.id
      AND (NEW.notes = 'mon-cahier:autre-cours:v1' OR s.notes = 'mon-cahier:autre-cours:v1')
  ) THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'class_session_already_open';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_exceptional_class_session() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_exceptional_class_session ON public.teacher_sessions;
CREATE TRIGGER guard_exceptional_class_session
BEFORE INSERT ON public.teacher_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_exceptional_class_session();

-- Retour arrière sans toucher aux données :
-- DROP TRIGGER guard_exceptional_class_session ON public.teacher_sessions;
-- DROP FUNCTION public.guard_exceptional_class_session();
