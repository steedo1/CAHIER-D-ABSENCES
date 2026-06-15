-- Import automatique des postes budgétaires de dépenses CSCA — année scolaire 2026-2027
-- À exécuter APRÈS sql/finance_expense_budgets_v1.sql
-- Script idempotent : si relancé, il met à jour les lignes importées au lieu de les dupliquer.
-- Source : photos du document budgétaire CSCA transmis.
-- NB : l'intitulé visible sur le papier peut mentionner 2025-2026, mais l'import demandé ici cible l'année scolaire 2026-2027.
-- Important : les montants manuscrits visibles sont conservés en notes et ne remplacent pas les montants imprimés,
-- sauf validation manuelle ultérieure.

BEGIN;

DO $$
DECLARE
  v_school_id uuid;
  v_academic_year_id uuid;
  v_imported integer := 0;
  r record;
BEGIN
  IF to_regclass('finance.expense_budget_lines') IS NULL THEN
    RAISE EXCEPTION 'La table finance.expense_budget_lines est absente. Exécute d''abord sql/finance_expense_budgets_v1.sql';
  END IF;

  SELECT i.id
    INTO v_school_id
  FROM public.institutions i
  WHERE lower(coalesce(i.code_unique, '')) = 'csca'
     OR lower(coalesce(i.name, '')) LIKE '%csca%'
     OR lower(coalesce(i.name, '')) LIKE '%catholique%aboisso%'
     OR lower(coalesce(i.name, '')) LIKE '%cours secondaire%catholique%aboisso%'
  ORDER BY
    CASE
      WHEN lower(coalesce(i.code_unique, '')) = 'csca' THEN 0
      WHEN lower(coalesce(i.name, '')) LIKE '%cours secondaire%catholique%aboisso%' THEN 1
      WHEN lower(coalesce(i.name, '')) LIKE '%catholique%aboisso%' THEN 2
      ELSE 3
    END,
    i.created_at ASC NULLS LAST
  LIMIT 1;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Institution CSCA introuvable. Vérifie le nom ou le code_unique de l''établissement dans public.institutions.';
  END IF;

  SELECT ay.id
    INTO v_academic_year_id
  FROM public.academic_years ay
  WHERE ay.institution_id = v_school_id
    AND (
      ay.code = '2026-2027'
      OR coalesce(ay.label, '') = '2026-2027'
    )
  ORDER BY ay.is_current DESC NULLS LAST, ay.start_date DESC NULLS LAST
  LIMIT 1;

  IF v_academic_year_id IS NULL THEN
    RAISE EXCEPTION 'Année scolaire 2026-2027 introuvable pour le CSCA. Crée d''abord l''année scolaire 2026-2027 pour cet établissement, puis relance le script.';
  END IF;

  FOR r IN
    SELECT *
    FROM (VALUES
      -- Page lisible 1 / début du document
      ('csca-2026-2027-p1-604150', 'Page 1', '604150', 'FRAIS DE SANTE', 2500000::numeric, NULL::text),
      ('csca-2026-2027-p1-604155', 'Page 1', '604155', 'MUTUELLE SAINT RAPHAEL', 2000000::numeric, NULL::text),
      ('csca-2026-2027-p1-604160', 'Page 1', '604160', 'TEST PSYCHO-ACTIF', 7500000::numeric, NULL::text),
      ('csca-2026-2027-p1-604170', 'Page 1', '604170', 'VISITE MEDICALE', 300000::numeric, NULL::text),
      ('csca-2026-2027-p1-604710', 'Page 1', '604710', 'FOURNITURE DE BUREAU', 700000::numeric, NULL::text),
      ('csca-2026-2027-p1-604730', 'Page 1', '604730', 'SPORTS ET LOISIRS', 200000::numeric, NULL::text),
      ('csca-2026-2027-p1-604749', 'Page 1', '604749', 'PHOTO D''IDENTITE', 500000::numeric, NULL::text),
      ('csca-2026-2027-p1-604750', 'Page 1', '604750', 'ACHATS TENUE EPS - MACARON - POLO ET CRAVATE', 7000000::numeric, NULL::text),
      ('csca-2026-2027-p1-604751', 'Page 1', '604751', 'KITS FEUILLES DE DEVOIRS', 2500000::numeric, 'Annotation manuscrite visible à vérifier : semble indiquer 1 500 000.'),
      ('csca-2026-2027-p1-604752', 'Page 1', '604752', 'CONFECTION LIVRETS (carnet corresp. et règlement intérieur)', 500000::numeric, 'Annotation manuscrite visible à vérifier.'),
      ('csca-2026-2027-p1-604755', 'Page 1', '604755', 'MATERIEL DIDACTIQUE', 500000::numeric, 'Annotation manuscrite visible à vérifier : semble indiquer 1 500 000.'),
      ('csca-2026-2027-p1-604760', 'Page 1', '604760', 'AUTRES DEPENSES / ACHATS DIVERS', 500000::numeric, 'Libellé manuscrit visible : ACHATS DIVERS.'),
      ('csca-2026-2027-p1-604800', 'Page 1', '604800', 'FOURNITURE ET MATERIEL INFORMATIQUE', 700000::numeric, NULL::text),
      ('csca-2026-2027-p1-605100', 'Page 1', '605100', 'SODECI', 50000::numeric, NULL::text),
      ('csca-2026-2027-p1-605200', 'Page 1', '605200', 'CIE', 2000000::numeric, 'Annotation manuscrite visible à vérifier : semble indiquer 2 500 000.'),
      ('csca-2026-2027-p1-605320', 'Page 1', '605320', 'CARBURANT MOTO DIRECTEUR', 400000::numeric, NULL::text),
      ('csca-2026-2027-p1-605800', 'Page 1', '605800', 'ACHAT MOBILIER', 500000::numeric, NULL::text),
      ('csca-2026-2027-p1-618000', 'Page 1', '618000', 'TRANSPORT ET TAXI', 200000::numeric, NULL::text),
      ('csca-2026-2027-p1-624110', 'Page 1', '624110', 'BATIMENT : REPARATION MENUISERIE', 1500000::numeric, NULL::text),
      ('csca-2026-2027-p1-624120', 'Page 1', '624120', 'BATIMENT : REPARATION ELECTRIQUE', 400000::numeric, NULL::text),
      ('csca-2026-2027-p1-624130', 'Page 1', '624130', 'BATIMENT : PEINTURE, ETANCHEITE, PLAFOND', 1000000::numeric, NULL::text),
      ('csca-2026-2027-p1-624140', 'Page 1', '624140', 'BATIMENT : PLOMBERIE', 250000::numeric, NULL::text),
      ('csca-2026-2027-p1-624150', 'Page 1', '624150', 'TRAVAUX DE REFECTION DES TOILETTES', 500000::numeric, NULL::text),
      ('csca-2026-2027-p1-624200', 'Page 1', '624200', 'ENTRETIEN MATERIEL ET MOBILIER', 50000::numeric, NULL::text),
      ('csca-2026-2027-p1-624300', 'Page 1', '624300', 'MAINTENANCE ET ENTRETIEN APP. INFORMATIQUE', 300000::numeric, NULL::text),
      ('csca-2026-2027-p1-624800', 'Page 1', '624800', 'ENTRETIEN ET REPARATION DIVERSES', 400000::numeric, NULL::text),
      ('csca-2026-2027-p1-624910', 'Page 1', '624910', 'AMENAGEMENT SALLES LABORATOIRE + BIBLIOTHEQUE', 2000000::numeric, NULL::text),
      ('csca-2026-2027-p1-625300', 'Page 1', '625300', 'ASSURANCE DES ELEVES + COTISATION PARENTS D''ELEVES', 600000::numeric, NULL::text),
      ('csca-2026-2027-p1-628121', 'Page 1', '628121', 'TELEPHONE MOBILE DE', 70000::numeric, NULL::text),
      ('csca-2026-2027-p1-628810', 'Page 1', '628810', 'INTERNET', 500000::numeric, NULL::text),
      ('csca-2026-2027-p1-631800', 'Page 1', '631800', 'FRAIS ET AGIOS BANCAIRES', 400000::numeric, NULL::text),
      ('csca-2026-2027-p1-632100', 'Page 1', '632100', 'FETES ET RENCONTRES', 1500000::numeric, 'Annotation manuscrite visible à vérifier : semble indiquer 2 000 000.'),
      ('csca-2026-2027-p1-632200', 'Page 1', '632200', 'FRAIS DE FORMATION ET REUNION', 500000::numeric, NULL::text),
      ('csca-2026-2027-p1-632500', 'Page 1', '632500', 'COMMUNICATION ET PUBLICITE', 1000000::numeric, NULL::text),

      -- Page de suite visible avec total imprimé 283 700 000
      ('csca-2026-2027-p2a-624810', 'Suite / total 283 700 000', '624810', 'ENVIRONNEMENT ET BUANDERIE', 300000::numeric, NULL::text),
      ('csca-2026-2027-p2a-625200', 'Suite / total 283 700 000', '625200', 'ASSURANCE VEHICULE SEMINAIRE', 200000::numeric, NULL::text),
      ('csca-2026-2027-p2a-625800', 'Suite / total 283 700 000', '625800', 'ASSURANCE', 360000::numeric, NULL::text),
      ('csca-2026-2027-p2a-625810', 'Suite / total 283 700 000', '625810', 'COTISATIONS OPUS SECURITATIS', 240000::numeric, NULL::text),
      ('csca-2026-2027-p2a-628810', 'Suite / total 283 700 000', '628810', 'INTERNET-JOURNAUX-T.V', 500000::numeric, NULL::text),
      ('csca-2026-2027-p2a-631800', 'Suite / total 283 700 000', '631800', 'FRAIS ET AGIOS BANCAIRES', 450000::numeric, 'Même compte/libellé visible ailleurs avec un autre montant ; conserver pour vérification.'),
      ('csca-2026-2027-p2a-632100', 'Suite / total 283 700 000', '632100', 'FETES ET RENCONTRES', 1000000::numeric, 'Même compte/libellé visible ailleurs avec un autre montant ; conserver pour vérification.'),
      ('csca-2026-2027-p2a-632200', 'Suite / total 283 700 000', '632200', 'FRAIS DE RETRAITE ET FORMATION', 1500000::numeric, NULL::text),
      ('csca-2026-2027-p2a-632500', 'Suite / total 283 700 000', '632500', 'COMMUNICATION ET PUBLICITE', 1500000::numeric, 'Même compte/libellé visible ailleurs avec un autre montant ; conserver pour vérification.'),
      ('csca-2026-2027-p2a-632600', 'Suite / total 283 700 000', '632600', 'FRAIS CONSTITUTION DOSSIER PATRIMOINE', 500000::numeric, NULL::text),
      ('csca-2026-2027-p2a-632730', 'Suite / total 283 700 000', '632730', 'MAIN D''OEUVRE OCCASIONNELLE', 500000::numeric, NULL::text),
      ('csca-2026-2027-p2a-638400', 'Suite / total 283 700 000', '638400', 'FRAIS DE MISSION SUPERIEUR', 700000::numeric, NULL::text),
      ('csca-2026-2027-p2a-646400', 'Suite / total 283 700 000', '646400', 'VIGNETTE, PATENTE, VISITE TECHNIQUE', 300000::numeric, NULL::text),
      ('csca-2026-2027-p2a-658100', 'Suite / total 283 700 000', '658100', 'JETONS DE PRESENCE', 2000000::numeric, NULL::text),
      ('csca-2026-2027-p2a-658200', 'Suite / total 283 700 000', '658200', 'DONS', 500000::numeric, NULL::text),
      ('csca-2026-2027-p2a-658320', 'Suite / total 283 700 000', '658320', 'CONTRIBUTION AU DIOCESE', 11000000::numeric, NULL::text),
      ('csca-2026-2027-p2a-658800', 'Suite / total 283 700 000', '658800', 'FRAIS DE MISE AU VERT', 500000::numeric, NULL::text),
      ('csca-2026-2027-p2a-661100', 'Suite / total 283 700 000', '661100', 'SALAIRES PERSONNEL LAIC', 35000000::numeric, 'Annotation manuscrite visible à vérifier : semble indiquer 4 500 000 sur la ligne.'),
      ('csca-2026-2027-p2a-661200', 'Suite / total 283 700 000', '661200', 'INDEMNITE DE LICENCIEMENT', 1500000::numeric, NULL::text),
      ('csca-2026-2027-p2a-661810', 'Suite / total 283 700 000', '661810', 'EMOLUMENTS PRETRES ET STAGIAIRES', 7000000::numeric, NULL::text),
      ('csca-2026-2027-p2a-661840', 'Suite / total 283 700 000', '661840', 'PRIMES DE VACANCES PRETRES', 600000::numeric, NULL::text),
      ('csca-2026-2027-p2a-664100', 'Suite / total 283 700 000', '664100', 'COTISATIONS CNPS', 4000000::numeric, NULL::text),

      -- Autre page visible avec total imprimé 109 000 000
      ('csca-2026-2027-p2b-632810', 'Suite / total 109 000 000', '632810', 'FRAIS DE POSTE', 50000::numeric, NULL::text),
      ('csca-2026-2027-p2b-638400', 'Suite / total 109 000 000', '638400', 'FRAIS DE MISSION SUPERIEUR', 100000::numeric, 'Même compte/libellé visible ailleurs avec un autre montant ; conserver pour vérification.'),
      ('csca-2026-2027-p2b-638600', 'Suite / total 109 000 000', '638600', 'FRAIS D''EXAMEN', 800000::numeric, NULL::text),
      ('csca-2026-2027-p2b-658200', 'Suite / total 109 000 000', '658200', 'DONS', 500000::numeric, NULL::text),
      ('csca-2026-2027-p2b-658320', 'Suite / total 109 000 000', '658320', 'CONTRIBUTION AU DIOCESE - PROJET MGR', 10000000::numeric, NULL::text),
      ('csca-2026-2027-p2b-658800', 'Suite / total 109 000 000', '658800', 'FRAIS DE MISE AU VERT', 2000000::numeric, NULL::text),
      ('csca-2026-2027-p2b-658810', 'Suite / total 109 000 000', '658810', 'SUIVI SCOLAIRE', 5000000::numeric, NULL::text),
      ('csca-2026-2027-p2b-661100', 'Suite / total 109 000 000', '661100', 'SALAIRES PERSONNEL LAIC', 20000000::numeric, 'Annotation manuscrite visible à vérifier : semble indiquer 21 000 000.'),
      ('csca-2026-2027-p2b-661200', 'Suite / total 109 000 000', '661200', 'PRIMES AU PERSONNEL', 500000::numeric, NULL::text),
      ('csca-2026-2027-p2b-661220', 'Suite / total 109 000 000', '661220', 'PAIEMENT DES HEURES SUP ET VACATIONS', 23000000::numeric, 'Annotation manuscrite visible à vérifier : semble indiquer 24 000 000.'),
      ('csca-2026-2027-p2b-661300', 'Suite / total 109 000 000', '661300', 'RECOMPENSE DE FIN D''ANNEE', 1000000::numeric, NULL::text),
      ('csca-2026-2027-p2b-661810', 'Suite / total 109 000 000', '661810', 'PRIME DIACRE ET PRETRES NON SALARIES', 1800000::numeric, NULL::text),
      ('csca-2026-2027-p2b-663810', 'Suite / total 109 000 000', '663810', 'FRAIS DE SOUTIEN (capital décès)', 500000::numeric, NULL::text),
      ('csca-2026-2027-p2b-663820', 'Suite / total 109 000 000', '663820', 'PRIME DE CAISSE COMPTABLE', 3500000::numeric, 'Annotation manuscrite visible à vérifier.'),
      ('csca-2026-2027-p2b-664100', 'Suite / total 109 000 000', '664100', 'COTISATIONS CNPS+CMU', 600000::numeric, NULL::text),
      ('csca-2026-2027-p2b-664110', 'Suite / total 109 000 000', '664110', 'COTISATIONS SEDEC', 600000::numeric, NULL::text)
    ) AS x(import_key, source_page, account_no, label, planned_amount, extra_note)
  LOOP
    UPDATE finance.expense_budget_lines
       SET academic_year_id = v_academic_year_id,
           academic_year = '2026-2027',
           account_no = r.account_no,
           label = r.label,
           planned_amount = r.planned_amount,
           notes = concat_ws(' | ', 'Import photo CSCA 2026-2027', 'source: ' || r.source_page, 'clé: ' || r.import_key, r.extra_note),
           is_active = true,
           updated_at = now()
     WHERE school_id = v_school_id
       AND academic_year = '2026-2027'
       AND notes ILIKE '%' || r.import_key || '%';

    IF NOT FOUND THEN
      INSERT INTO finance.expense_budget_lines (
        school_id,
        academic_year_id,
        academic_year,
        category_id,
        account_no,
        label,
        planned_amount,
        notes,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        v_school_id,
        v_academic_year_id,
        '2026-2027',
        NULL,
        r.account_no,
        r.label,
        r.planned_amount,
        concat_ws(' | ', 'Import photo CSCA 2026-2027', 'source: ' || r.source_page, 'clé: ' || r.import_key, r.extra_note),
        true,
        now(),
        now()
      );
    END IF;

    v_imported := v_imported + 1;
  END LOOP;

  RAISE NOTICE 'Import/actualisation terminé : % postes budgétaires traités pour CSCA 2026-2027.', v_imported;
END $$;

COMMIT;

-- Contrôle rapide après import.
SELECT
  count(*) AS lignes_importees,
  sum(planned_amount)::bigint AS total_budget_importe
FROM finance.expense_budget_lines
WHERE academic_year = '2026-2027'
  AND notes ILIKE '%Import photo CSCA 2026-2027%';

SELECT
  account_no,
  label,
  planned_amount::bigint AS montant,
  notes
FROM finance.expense_budget_lines
WHERE academic_year = '2026-2027'
  AND notes ILIKE '%Import photo CSCA 2026-2027%'
ORDER BY account_no, label;
