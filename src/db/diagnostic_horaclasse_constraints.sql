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


-- 5) Affectations des enseignants qui sortent souvent en "Non placé".
-- Remplace les noms dans le ILIKE si besoin.
select
  p.id as teacher_id,
  p.display_name as teacher_name,
  c.label as class_label,
  coalesce(isub.custom_name, subj.name, 'Matière') as subject_label,
  ct.end_date
from public.class_teachers ct
left join public.profiles p on p.id = ct.teacher_id
left join public.classes c on c.id = ct.class_id
left join public.institution_subjects isub on isub.id = ct.subject_id
left join public.subjects subj on subj.id = isub.subject_id
where ct.institution_id = :institution_id
  and coalesce(p.display_name, '') ilike any (array['%Yapo%', '%Meite%', '%Kouadio%'])
order by p.display_name, c.label, subject_label;

-- 6) Indisponibilités détaillées de ces enseignants.
select
  p.display_name as teacher_name,
  tu.weekday,
  tu.period_no,
  tu.half_day,
  tu.constraint_type,
  coalesce(tu.is_active, true) as is_active,
  tu.reason
from public.montage_timetable_teacher_unavailability tu
left join public.profiles p on p.id = tu.teacher_id
where tu.institution_id = :institution_id
  and coalesce(p.display_name, '') ilike any (array['%Yapo%', '%Meite%', '%Kouadio%'])
order by p.display_name, tu.weekday, tu.period_no nulls first, tu.half_day nulls first;

-- 7) Volumes HoraClasse personnalisés pour ces enseignants, si existants.
select
  p.display_name as teacher_name,
  c.label as class_label,
  coalesce(isub.custom_name, subj.name, 'Matière') as subject_label,
  h.weekly_units,
  h.split_pattern,
  h.room_type_required
from public.montage_timetable_subject_hours h
left join public.profiles p on p.id = h.teacher_id
left join public.classes c on c.id = h.class_id
left join public.institution_subjects isub on isub.id = h.subject_id
left join public.subjects subj on subj.id = isub.subject_id
where h.institution_id = :institution_id
  and coalesce(p.display_name, '') ilike any (array['%Yapo%', '%Meite%', '%Kouadio%'])
order by p.display_name, c.label, subject_label;
