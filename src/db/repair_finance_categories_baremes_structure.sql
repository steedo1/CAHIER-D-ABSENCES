-- ============================================================
-- REPARATION / DIAGNOSTIC CATEGORIES + BAREMES FINANCE
-- Ne supprime rien.
-- Objectif : garantir que les catégories métier de base existent
-- pour le CSCA, sans toucher aux barèmes, dettes, reçus ou encaissements.
-- ============================================================

BEGIN;

WITH params AS (
  SELECT 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id
),
defaults(code, name, description, is_mandatory) AS (
  VALUES
    (
      'scolarite',
      'Scolarité',
      'Frais liés à la scolarité : inscription, frais généraux, frais annexes scolarité, écolage affecté ou non affecté.',
      TRUE
    ),
    (
      'internat',
      'Internat',
      'Vie à l’internat : pension fixe et frais annexes variables selon les éléments confirmés.',
      FALSE
    ),
    (
      'cours_renforcement',
      'Cours de renforcement',
      'Frais spécifiques aux cours de renforcement, uniquement pour les élèves concernés.',
      FALSE
    )
),
existing AS (
  SELECT fc.id, fc.code
  FROM finance.fee_categories fc
  JOIN params p ON p.school_id = fc.school_id
),
inserted AS (
  INSERT INTO finance.fee_categories (
    school_id,
    code,
    name,
    description,
    is_mandatory,
    is_active,
    created_at,
    updated_at
  )
  SELECT
    p.school_id,
    d.code,
    d.name,
    d.description,
    d.is_mandatory,
    TRUE,
    now(),
    now()
  FROM params p
  CROSS JOIN defaults d
  WHERE NOT EXISTS (
    SELECT 1
    FROM existing e
    WHERE e.code = d.code
  )
  RETURNING id, code
),
updated AS (
  UPDATE finance.fee_categories fc
  SET
    name = d.name,
    description = COALESCE(fc.description, d.description),
    is_active = TRUE,
    updated_at = now()
  FROM params p
  JOIN defaults d ON d.code = fc.code
  WHERE fc.school_id = p.school_id
  RETURNING fc.id, fc.code
)
SELECT
  (SELECT COUNT(*) FROM inserted) AS categories_creees,
  (SELECT COUNT(*) FROM updated) AS categories_verifiees;

COMMIT;

-- Diagnostic final
SELECT
  fc.code,
  fc.name,
  fc.is_active,
  fc.is_mandatory,
  COUNT(fs.id) FILTER (WHERE fs.is_active IS TRUE) AS baremes_actifs
FROM finance.fee_categories fc
LEFT JOIN finance.fee_schedules fs
  ON fs.fee_category_id = fc.id
 AND fs.school_id = fc.school_id
WHERE fc.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
GROUP BY fc.id, fc.code, fc.name, fc.is_active, fc.is_mandatory
ORDER BY fc.name;
