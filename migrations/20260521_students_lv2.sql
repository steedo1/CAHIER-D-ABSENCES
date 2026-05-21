-- 20260521_students_lv2.sql
-- Mon Cahier : LV2 devient une donnée officielle de l'élève.
-- Objectif : éviter une table parallèle pour les listes de classe afin que
-- bulletins, conseils de classe, DESPS, matrices et autres exports puissent lire
-- les informations directement depuis public.students.

BEGIN;

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS lv2 text;

COMMENT ON COLUMN public.students.lv2 IS
'Langue vivante 2 de l’élève (exemples : ALL, ESP). Utilisée par les listes de classe et disponible pour les exports officiels.';

-- Si l'ancien correctif student_roster_details existe déjà, on rapatrie les LV2
-- déjà saisies vers public.students, sans écraser les valeurs déjà présentes.
DO $$
BEGIN
  IF to_regclass('public.student_roster_details') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.students s
         SET lv2 = NULLIF(upper(trim(d.lv2)), '')
        FROM public.student_roster_details d
       WHERE d.student_id = s.id
         AND d.lv2 IS NOT NULL
         AND NULLIF(trim(coalesce(s.lv2, '')), '') IS NULL
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_institution_lv2
ON public.students (institution_id, lv2)
WHERE lv2 IS NOT NULL;

COMMIT;
