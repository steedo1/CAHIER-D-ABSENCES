-- Diagnostic non destructif HoraClasse / Mon Cahier
-- Remplace :institution_id par l'id de l'établissement si ton runner ne gère pas les variables.

-- 1) Indisponibilités actives enregistrées
select
  teacher_id,
  weekday,
  period_no,
  half_day,
  constraint_type,
  is_active,
  reason,
  created_at,
  updated_at
from public.montage_timetable_teacher_unavailability
where institution_id = :institution_id
  and coalesce(is_active, true) = true
order by teacher_id, weekday, period_no nulls first, half_day nulls first;

-- 2) Indisponibilités "journée entière" : c'était le cas non bloqué avant le correctif
select
  teacher_id,
  weekday,
  count(*) as total_full_day_constraints
from public.montage_timetable_teacher_unavailability
where institution_id = :institution_id
  and coalesce(is_active, true) = true
  and period_no is null
  and half_day is null
group by teacher_id, weekday
order by teacher_id, weekday;

-- 3) Créneaux officiels réellement ouverts
select
  weekday,
  period_no,
  label,
  start_time,
  end_time
from public.institution_periods
where institution_id = :institution_id
order by weekday, period_no;

-- 4) Règles terrain stockées
select
  rules
from public.montage_timetable_terrain_rules
where institution_id = :institution_id;
