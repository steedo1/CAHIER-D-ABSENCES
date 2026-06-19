DO $$
DECLARE
  v_student_count integer := 0;
  v_inserted_count integer := 0;
BEGIN
  WITH target_students AS (
    SELECT DISTINCT
      s.id AS student_id,
      s.institution_id,
      ce.class_id,
      c.academic_year
    FROM public.students s
    JOIN public.institutions i ON i.id = s.institution_id
    JOIN public.class_enrollments ce
      ON ce.student_id = s.id
     AND ce.institution_id = s.institution_id
     AND ce.end_date IS NULL
    JOIN public.classes c
      ON c.id = ce.class_id
     AND c.institution_id = s.institution_id
    WHERE (
        coalesce(i.code_unique, '') = '000657'
        OR upper(coalesce(i.name, '')) LIKE '%COURS SECONDAIRE CATHOLIQUE%ABOISSO%'
      )
      AND (
        upper(trim(concat_ws(' ', s.last_name, s.first_name))) LIKE 'KOUADIO ANGE%'
        OR upper(trim(concat_ws(' ', s.first_name, s.last_name))) LIKE 'KOUADIO ANGE%'
        OR upper(trim(coalesce(s.full_name, ''))) LIKE 'KOUADIO ANGE%'
      )
  )
  SELECT count(*) INTO v_student_count FROM target_students;

  IF v_student_count = 0 THEN
    RAISE NOTICE 'Aucun élève KOUADIO ANGE trouvé au CSCA.';
    RETURN;
  END IF;

  IF v_student_count > 5 THEN
    RAISE EXCEPTION 'Sécurité : % élèves correspondent au filtre. Génération annulée.', v_student_count;
  END IF;

  WITH target_students AS (
    SELECT DISTINCT
      s.id AS student_id,
      s.institution_id,
      ce.class_id,
      c.academic_year
    FROM public.students s
    JOIN public.institutions i ON i.id = s.institution_id
    JOIN public.class_enrollments ce
      ON ce.student_id = s.id
     AND ce.institution_id = s.institution_id
     AND ce.end_date IS NULL
    JOIN public.classes c
      ON c.id = ce.class_id
     AND c.institution_id = s.institution_id
    WHERE (
        coalesce(i.code_unique, '') = '000657'
        OR upper(coalesce(i.name, '')) LIKE '%COURS SECONDAIRE CATHOLIQUE%ABOISSO%'
      )
      AND (
        upper(trim(concat_ws(' ', s.last_name, s.first_name))) LIKE 'KOUADIO ANGE%'
        OR upper(trim(concat_ws(' ', s.first_name, s.last_name))) LIKE 'KOUADIO ANGE%'
        OR upper(trim(coalesce(s.full_name, ''))) LIKE 'KOUADIO ANGE%'
      )
  ), inserted AS (
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
      created_at,
      updated_at
    )
    SELECT
      ts.institution_id,
      ay.id,
      coalesce(fs.academic_year, ts.academic_year),
      ts.student_id,
      ts.class_id,
      fs.id,
      fs.fee_category_id,
      fs.label,
      fs.amount,
      fs.due_date,
      current_date,
      'pending',
      coalesce(fs.notes, 'Situation créée automatiquement depuis le barème ' || fs.label),
      now(),
      now()
    FROM target_students ts
    JOIN finance.fee_schedules fs
      ON fs.school_id = ts.institution_id
     AND fs.class_id = ts.class_id
     AND fs.is_active = true
    LEFT JOIN public.academic_years ay
      ON ay.institution_id = ts.institution_id
     AND ay.code = coalesce(fs.academic_year, ts.academic_year)
    WHERE NOT EXISTS (
      SELECT 1
      FROM finance.student_charges sc
      WHERE sc.school_id = ts.institution_id
        AND sc.student_id = ts.student_id
        AND sc.class_id = ts.class_id
        AND sc.fee_schedule_id = fs.id
    )
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_count FROM inserted;

  RAISE NOTICE 'Élèves concernés : %, situations financières créées : %.', v_student_count, v_inserted_count;

  IF v_inserted_count = 0 THEN
    RAISE NOTICE 'Aucune situation créée. Cause probable : aucun barème actif finance.fee_schedules pour la classe de ces élèves, ou situations déjà existantes.';
  END IF;
END $$;

SELECT
  s.matricule,
  trim(concat_ws(' ', s.last_name, s.first_name)) AS eleve,
  c.label AS classe,
  c.academic_year,
  count(sc.id) AS nb_frais_ouverts,
  coalesce(sum(sc.base_amount), 0)::bigint AS total_attendu
FROM public.students s
JOIN public.institutions i ON i.id = s.institution_id
JOIN public.class_enrollments ce
  ON ce.student_id = s.id
 AND ce.institution_id = s.institution_id
 AND ce.end_date IS NULL
JOIN public.classes c
  ON c.id = ce.class_id
 AND c.institution_id = s.institution_id
LEFT JOIN finance.student_charges sc
  ON sc.school_id = s.institution_id
 AND sc.student_id = s.id
 AND sc.class_id = c.id
 AND coalesce(sc.status, '') <> 'cancelled'
WHERE (
    coalesce(i.code_unique, '') = '000657'
    OR upper(coalesce(i.name, '')) LIKE '%COURS SECONDAIRE CATHOLIQUE%ABOISSO%'
  )
  AND (
    upper(trim(concat_ws(' ', s.last_name, s.first_name))) LIKE 'KOUADIO ANGE%'
    OR upper(trim(concat_ws(' ', s.first_name, s.last_name))) LIKE 'KOUADIO ANGE%'
    OR upper(trim(coalesce(s.full_name, ''))) LIKE 'KOUADIO ANGE%'
  )
GROUP BY s.matricule, s.last_name, s.first_name, c.label, c.academic_year
ORDER BY c.label, eleve;
