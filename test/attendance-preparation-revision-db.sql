-- PostgreSQL isolé : aucune donnée d'un établissement réel.
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE public.institutions(id uuid PRIMARY KEY);
INSERT INTO public.institutions VALUES
 ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
CREATE TABLE public.attendance_schedule_revisions(
 institution_id uuid PRIMARY KEY REFERENCES public.institutions(id),
 revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.attendance_schedule_revisions(institution_id,revision)
SELECT id,17 FROM public.institutions;
CREATE TABLE public.teacher_sessions(id uuid PRIMARY KEY,institution_id uuid NOT NULL REFERENCES public.institutions(id),ended_at timestamptz);
CREATE TABLE public.attendance_marks(id uuid PRIMARY KEY,session_id uuid REFERENCES public.teacher_sessions(id) ON DELETE CASCADE,status text);
CREATE TABLE public.classes(id uuid PRIMARY KEY,institution_id uuid NOT NULL REFERENCES public.institutions(id),label text);
INSERT INTO public.classes VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','TA');
CREATE FUNCTION public.lock_relay_revision_scope(scoped_institution_id uuid)
RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(hashtextextended('mon-cahier:relay-revision:' || scoped_institution_id::text,0)) $$;
CREATE FUNCTION public.bump_attendance_schedule_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.bump_attendance_schedule_revision_value(NEW.institution_id);
 RETURN NEW;
END $$;
CREATE TRIGGER test_configuration_revision AFTER UPDATE ON public.classes
FOR EACH ROW EXECUTE FUNCTION public.bump_attendance_schedule_revision();

\ir ../migrations/20261009133018_attendance_preparation_stable_revision.sql

-- Un cours, ses marques et sa fermeture : une révision de données, aucun planning périmé.
BEGIN;
INSERT INTO public.teacher_sessions VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001',NULL);
INSERT INTO public.attendance_marks VALUES
 ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004','absent'),
 ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000004','late');
UPDATE public.teacher_sessions SET ended_at=now();
COMMIT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000001' AND revision=18 AND preparation_revision=17)
 THEN RAISE EXCEPTION 'Un appel invalide le planning ou perd la révision relais'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000002' AND revision=17 AND preparation_revision=17)
 THEN RAISE EXCEPTION 'Autre établissement modifié'; END IF;
END $$;

-- Une correction élève est récupérable par le relais, avec la même préparation.
UPDATE public.attendance_marks SET status='present' WHERE id='00000000-0000-0000-0000-000000000005';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000001' AND revision=19 AND preparation_revision=17)
 THEN RAISE EXCEPTION 'Correction élève mal suivie'; END IF;
END $$;

-- Une vraie modification et un appel dans la même transaction invalident bien la préparation.
BEGIN;
UPDATE public.teacher_sessions SET ended_at=now();
UPDATE public.classes SET label='TA modifiée';
COMMIT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000001' AND revision=20 AND preparation_revision=18)
 THEN RAISE EXCEPTION 'Modification réelle masquée par la déduplication transactionnelle'; END IF;
END $$;

-- Un transfert touche les deux établissements sans changer leurs configurations.
UPDATE public.teacher_sessions SET institution_id='00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000001' AND revision=21 AND preparation_revision=18)
 OR NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000002' AND revision=18 AND preparation_revision=17)
 THEN RAISE EXCEPTION 'Transfert inter-établissements incorrect'; END IF;
END $$;

-- Effacement avec cascade : les appels disparaissent, le planning reste préparé.
DELETE FROM public.teacher_sessions;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.attendance_marks) OR NOT EXISTS(
 SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000002' AND revision=19 AND preparation_revision=17)
 THEN RAISE EXCEPTION 'Cascade ou révision d’effacement incorrecte'; END IF;
END $$;

-- Une transaction annulée ne publie aucun changement et ne crée aucun appel.
BEGIN;
INSERT INTO public.teacher_sessions VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002',NULL);
UPDATE public.classes SET label='ne doit pas rester';
ROLLBACK;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.teacher_sessions) OR EXISTS(SELECT 1 FROM public.classes WHERE label='ne doit pas rester')
 OR NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000001' AND revision=21 AND preparation_revision=18)
 OR NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000002' AND revision=19 AND preparation_revision=17)
 THEN RAISE EXCEPTION 'Rollback invalide'; END IF;
 IF has_function_privilege('anon','public.bump_attendance_live_revision_value(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.bump_attendance_preparation_revision_value(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Compteur accessible sans autorisation'; END IF;
END $$;
-- Rejouer la migration ne périme pas les préparations déjà vérifiées.
\ir ../migrations/20261009133018_attendance_preparation_stable_revision.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000001' AND revision=21 AND preparation_revision=18)
 OR NOT EXISTS(SELECT 1 FROM public.attendance_schedule_revisions
 WHERE institution_id='00000000-0000-0000-0000-000000000002' AND revision=19 AND preparation_revision=17)
 THEN RAISE EXCEPTION 'Migration rejouée : préparation modifiée'; END IF;
END $$;
SELECT 'attendance preparation database checks passed' AS verification;
