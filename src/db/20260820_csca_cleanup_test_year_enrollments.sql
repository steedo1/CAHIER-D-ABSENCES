-- CSCA 2025-2026 — NETTOYAGE DES INSCRIPTIONS DE L'ANNÉE TEST
-- NE PAS exécuter avant validation de la réconciliation 2026-2027.
-- Ne touche ni aux élèves 2026-2027, ni aux enseignants, ni à la finance.

begin;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.class_enrollments ce
  join public.classes c on c.id=ce.class_id
  where ce.institution_id='ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
    and c.academic_year='2025-2026';

  if v_count=0 then
    raise exception 'Aucune inscription CSCA 2025-2026 à nettoyer.';
  end if;

  if exists (
    select 1
    from public.student_period_results spr
    join public.class_enrollments ce on ce.id=spr.enrollment_id
    join public.classes c on c.id=ce.class_id
    where ce.institution_id='ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
      and c.academic_year='2025-2026'
  ) or exists (
    select 1
    from public.student_subject_period_results sspr
    join public.class_enrollments ce on ce.id=sspr.enrollment_id
    join public.classes c on c.id=ce.class_id
    where ce.institution_id='ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
      and c.academic_year='2025-2026'
  ) or exists (
    select 1
    from public.ai_training_samples ats
    join public.class_enrollments ce on ce.id=ats.enrollment_id
    join public.classes c on c.id=ce.class_id
    where ce.institution_id='ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
      and c.academic_year='2025-2026'
  ) then
    raise exception 'Nettoyage annulé : des données métier référencent encore les inscriptions 2025-2026.';
  end if;
end $$;

delete from public.class_enrollments ce
using public.classes c
where ce.class_id=c.id
  and ce.institution_id='ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
  and c.academic_year='2025-2026';

-- Garde-fou absolu : aucune inscription 2026-2027 n'a été touchée.
do $$
begin
  if not exists (
    select 1 from public.class_enrollments ce
    join public.classes c on c.id=ce.class_id
    where ce.institution_id='ee34ab2a-8033-4e0b-acf0-05979cce1697'::uuid
      and c.academic_year='2026-2027'
  ) then
    raise exception 'Nettoyage annulé : contrôle 2026-2027 incohérent.';
  end if;
end $$;

commit;
