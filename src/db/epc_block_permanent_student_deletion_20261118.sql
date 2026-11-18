-- EPC Dimbokro / 2026-11-18
-- Protection immédiate de l'établissement après suppression involontaire.
-- Migration appliquée directement sur Supabase (projet MonCahierAsence).
-- Le retrait de classe s'effectue dans class_enrollments.end_date ;
-- une suppression de la fiche élève reste bloquée au niveau SQL.

CREATE OR REPLACE FUNCTION epc_internal.block_epc_student_hard_deletes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.institution_id = '2b897cd4-e1c3-40c3-9569-03e01e1877b4'::uuid THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'EPC : suppression definitive des fiches eleves suspendue pour eviter toute perte. Le retrait de classe doit conserver le dossier.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_epc_block_student_hard_deletes ON public.students;
CREATE TRIGGER trg_epc_block_student_hard_deletes
BEFORE DELETE ON public.students
FOR EACH ROW
EXECUTE FUNCTION epc_internal.block_epc_student_hard_deletes();
