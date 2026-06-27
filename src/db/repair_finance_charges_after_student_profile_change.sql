-- Réparation / resynchronisation des dettes après modification du profil élève
-- Exemple : Externe -> Interne ou Interne -> Externe dans Liste des classes.
-- À NE PAS exécuter sans contrôle : réparation globale. Préférer le correctif applicatif élève par élève.

WITH active_students AS (
  SELECT
    ce.institution_id AS school_id,
    ce.class_id,
    ce.student_id,
    s.is_affecte,
    s.is_boarder
  FROM public.class_enrollments ce
  JOIN public.students s ON s.id = ce.student_id
  WHERE ce.end_date IS NULL
), active_schedules AS (
  SELECT
    fs.*,
    lower(trim(fs.label)) AS label_key
  FROM finance.fee_schedules fs
  WHERE fs.is_active = true
    AND fs.class_id IS NOT NULL
), schedule_application AS (
  SELECT
    a.school_id,
    a.class_id,
    a.student_id,
    sc.id AS fee_schedule_id,
    sc.fee_category_id,
    sc.academic_year,
    sc.label,
    sc.amount,
    sc.due_date,
    sc.notes,
    CASE
      WHEN sc.label_key LIKE 'scolarité - inscription%'
        OR sc.label_key LIKE 'scolarite - inscription%'
        OR sc.label_key LIKE 'scolarité - frais généraux%'
        OR sc.label_key LIKE 'scolarite - frais generaux%'
        OR sc.label_key LIKE 'scolarité - frais annexes scolarité%'
        OR sc.label_key LIKE 'scolarite - frais annexes scolarite%'
        THEN true
      WHEN sc.label_key LIKE 'scolarité - écolage non affecté%'
        OR sc.label_key LIKE 'scolarite - ecolage non affecte%'
        THEN a.is_affecte IS FALSE
      WHEN sc.label_key LIKE 'scolarité - écolage affecté%'
        OR sc.label_key LIKE 'scolarite - ecolage affecte%'
        THEN a.is_affecte IS TRUE
      WHEN sc.label_key LIKE 'internat - pension%'
        OR sc.label_key LIKE 'internat - frais annexes internat%'
        THEN a.is_boarder IS TRUE
      ELSE NULL
    END AS applies
  FROM active_students a
  JOIN active_schedules sc
    ON sc.school_id = a.school_id
   AND sc.class_id = a.class_id
), missing_applicable_charges AS (
  INSERT INTO finance.student_charges (
    school_id,
    academic_year_id,
    academic_year,
    student_id,
    class_id,
    fee_schedule_id,
    fee_category_id,
    label,
    base_amount,
    due_date,
    charge_date,
    status,
    notes,
    created_by,
    created_at,
    updated_at
  )
  SELECT
    sa.school_id,
    ay.id AS academic_year_id,
    COALESCE(sa.academic_year, c.academic_year),
    sa.student_id,
    sa.class_id,
    sa.fee_schedule_id,
    sa.fee_category_id,
    sa.label,
    COALESCE(sa.amount, 0),
    sa.due_date,
    CURRENT_DATE,
    'pending',
    COALESCE(sa.notes, 'Dette créée automatiquement après resynchronisation du profil élève.'),
    NULL,
    NOW(),
    NOW()
  FROM schedule_application sa
  JOIN public.classes c ON c.id = sa.class_id AND c.institution_id = sa.school_id
  LEFT JOIN public.academic_years ay
    ON ay.institution_id = sa.school_id
   AND ay.code = COALESCE(sa.academic_year, c.academic_year)
  LEFT JOIN finance.student_charges existing
    ON existing.school_id = sa.school_id
   AND existing.student_id = sa.student_id
   AND existing.class_id = sa.class_id
   AND existing.fee_schedule_id = sa.fee_schedule_id
  WHERE sa.applies IS TRUE
    AND existing.id IS NULL
  RETURNING id
), not_applicable_balances AS (
  SELECT
    vb.id,
    vb.school_id,
    vb.paid_amount,
    vb.balance_due,
    COALESCE(vb.adjustment_total, 0) AS adjustment_total
  FROM finance.v_charge_balances vb
  JOIN schedule_application sa
    ON sa.school_id = vb.school_id
   AND sa.student_id = vb.student_id
   AND sa.class_id = vb.class_id
   AND sa.fee_schedule_id = vb.fee_schedule_id
  WHERE sa.applies IS FALSE
    AND COALESCE(vb.computed_status::text, '') <> 'cancelled'
), cancelled_unpaid AS (
  UPDATE finance.student_charges sc
     SET status = 'cancelled',
         notes = COALESCE(sc.notes, '') || CASE WHEN COALESCE(sc.notes, '') = '' THEN '' ELSE ' ' END || 'Dette annulée par resynchronisation du profil élève.',
         updated_at = NOW()
    FROM not_applicable_balances b
   WHERE sc.id = b.id
     AND sc.school_id = b.school_id
     AND COALESCE(b.paid_amount, 0) <= 0
  RETURNING sc.id
), settled_paid AS (
  UPDATE finance.student_charges sc
     SET base_amount = GREATEST(COALESCE(b.paid_amount, 0) - COALESCE(b.adjustment_total, 0), 0),
         status = 'paid',
         notes = 'Profil financier modifié : solde restant neutralisé, encaissement déjà reçu conservé.',
         updated_at = NOW()
    FROM not_applicable_balances b
   WHERE sc.id = b.id
     AND sc.school_id = b.school_id
     AND COALESCE(b.paid_amount, 0) > 0
     AND COALESCE(b.balance_due, 0) > 0
  RETURNING sc.id
)
SELECT
  (SELECT COUNT(*) FROM missing_applicable_charges) AS dettes_creees,
  (SELECT COUNT(*) FROM cancelled_unpaid) AS dettes_annulees_sans_paiement,
  (SELECT COUNT(*) FROM settled_paid) AS dettes_soldees_avec_historique_conserve;
