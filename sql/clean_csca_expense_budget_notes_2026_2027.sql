-- Nettoyage des notes techniques d'import sur les postes budgétaires CSCA 2026-2027
-- Objectif : retirer de l'interface les textes du type :
-- "Import photo CSCA 2026-2027 | source: Page 1 | clé: ..."
-- Le script ne touche PAS aux comptes, libellés, montants, dépenses, ni rattachements.

BEGIN;

DO $$
DECLARE
  v_school_id uuid;
  v_updated integer := 0;
BEGIN
  SELECT i.id
    INTO v_school_id
  FROM public.institutions i
  WHERE i.id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
     OR lower(coalesce(i.code_unique, '')) IN ('csca', '000657')
     OR lower(coalesce(i.name, '')) LIKE '%csca%'
     OR lower(coalesce(i.name, '')) LIKE '%cours secondaire%catholique%aboisso%'
     OR lower(coalesce(i.name, '')) LIKE '%catholique%aboisso%'
  ORDER BY
    CASE
      WHEN i.id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid THEN 0
      WHEN lower(coalesce(i.code_unique, '')) = '000657' THEN 1
      WHEN lower(coalesce(i.code_unique, '')) = 'csca' THEN 2
      WHEN lower(coalesce(i.name, '')) LIKE '%cours secondaire%catholique%aboisso%' THEN 3
      ELSE 4
    END,
    i.created_at ASC NULLS LAST
  LIMIT 1;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Institution CSCA introuvable. Vérifie public.institutions.';
  END IF;

  UPDATE finance.expense_budget_lines
     SET notes = NULL,
         updated_at = now()
   WHERE school_id = v_school_id
     AND academic_year = '2026-2027'
     AND (
       notes ILIKE '%Import photo CSCA 2026-2027%'
       OR notes ILIKE '%csca-2026-2027%'
       OR notes ILIKE '%Annotation manuscrite visible%'
       OR notes ILIKE '%Libellé manuscrit visible%'
       OR notes ILIKE '%Même compte/libellé visible ailleurs%'
     );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Notes techniques supprimées : % lignes CSCA 2026-2027.', v_updated;
END $$;

COMMIT;

-- Contrôle : ces deux valeurs doivent confirmer que les postes existent et que les notes import ont disparu.
SELECT
  COUNT(*) AS postes_csca_2026_2027,
  SUM(planned_amount)::bigint AS total_budget,
  COUNT(*) FILTER (WHERE notes IS NOT NULL AND btrim(notes) <> '') AS postes_avec_notes_restantes
FROM finance.expense_budget_lines
WHERE school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  AND academic_year = '2026-2027';
