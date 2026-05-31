-- ============================================================
-- MON CAHIER — CSCA : reçus séparés par catégorie sensible
-- Objectif :
--   1) Vérifier/créer les catégories Cours de renforcement et Kit livres.
--   2) Diagnostiquer les anciens reçus qui mélangent :
--      - Scolarité / Internat
--      - Cours de renforcement
--      - Kit livres
--
-- Ce script ne modifie aucun reçu déjà validé.
-- Il évite toute correction comptable automatique dangereuse.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

WITH params AS (
  SELECT 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id
),
defaults(code, name, description, is_mandatory) AS (
  VALUES
    (
      'cours_renforcement',
      'Cours de renforcement',
      'Frais spécifiques aux cours de renforcement. Cette catégorie doit produire son propre reçu séparé.',
      FALSE
    ),
    (
      'kit_livres',
      'Kit livres',
      'Frais liés aux kits livres/fournitures. Cette catégorie doit produire son propre reçu séparé.',
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
  RETURNING id, code, name
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
  RETURNING fc.id, fc.code, fc.name
)
SELECT
  'categories_separees_verifiees' AS check_name,
  (SELECT COUNT(*) FROM inserted) AS categories_creees,
  (SELECT COUNT(*) FROM updated) AS categories_verifiees;

COMMIT;

-- 1) Vue rapide des catégories sensibles.
WITH params AS (
  SELECT 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid AS school_id
)
SELECT
  fc.id,
  fc.code,
  fc.name,
  fc.is_active,
  COUNT(fs.id) FILTER (WHERE fs.is_active IS TRUE) AS baremes_actifs
FROM finance.fee_categories fc
LEFT JOIN finance.fee_schedules fs
  ON fs.school_id = fc.school_id
 AND fs.fee_category_id = fc.id
WHERE fc.school_id = (SELECT school_id FROM params)
  AND (
    lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%renforcement%'
    OR lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%livre%'
    OR lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%kit%'
  )
GROUP BY fc.id, fc.code, fc.name, fc.is_active
ORDER BY fc.name;

-- 2) Diagnostic des reçus validés qui mélangent des catégories qui doivent être séparées.
--    Résultat attendu après les corrections applicatives pour les nouveaux reçus : 0 ligne récente.
WITH receipt_categories AS (
  SELECT
    r.id AS receipt_id,
    r.receipt_no,
    r.payment_date,
    r.student_id,
    r.total_amount,
    string_agg(DISTINCT fc.name, ' | ' ORDER BY fc.name) AS categories,
    bool_or(
      lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%scolar%'
      OR lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%ecolage%'
      OR lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%internat%'
    ) AS has_scolarite_or_internat,
    bool_or(lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%renforcement%') AS has_renforcement,
    bool_or(
      lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%livre%'
      OR lower(unaccent(coalesce(fc.code, '') || ' ' || coalesce(fc.name, ''))) LIKE '%kit%'
    ) AS has_kit_livres
  FROM finance.receipts r
  JOIN finance.receipt_allocations ra
    ON ra.receipt_id = r.id
  JOIN finance.student_charges sc
    ON sc.id = ra.student_charge_id
  JOIN finance.fee_categories fc
    ON fc.id = sc.fee_category_id
  WHERE r.school_id = 'ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    AND r.receipt_status = 'posted'
  GROUP BY r.id, r.receipt_no, r.payment_date, r.student_id, r.total_amount
)
SELECT
  rc.receipt_no,
  rc.payment_date,
  s.last_name,
  s.first_name,
  s.matricule,
  rc.total_amount,
  rc.categories,
  CASE
    WHEN rc.has_scolarite_or_internat AND rc.has_renforcement THEN 'MELANGE_SCOLARITE_INTERNAT_AVEC_RENFORCEMENT'
    WHEN rc.has_scolarite_or_internat AND rc.has_kit_livres THEN 'MELANGE_SCOLARITE_INTERNAT_AVEC_KIT_LIVRES'
    WHEN rc.has_renforcement AND rc.has_kit_livres THEN 'MELANGE_RENFORCEMENT_AVEC_KIT_LIVRES'
    ELSE 'OK'
  END AS diagnostic
FROM receipt_categories rc
LEFT JOIN public.students s
  ON s.id = rc.student_id
WHERE
  (rc.has_scolarite_or_internat AND (rc.has_renforcement OR rc.has_kit_livres))
  OR (rc.has_renforcement AND rc.has_kit_livres)
ORDER BY rc.payment_date DESC, rc.receipt_no DESC;
