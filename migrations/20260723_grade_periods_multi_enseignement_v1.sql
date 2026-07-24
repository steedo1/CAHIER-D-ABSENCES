-- MON CAHIER — Périodes d'évaluation multi-enseignement V1
-- Migration additive : aucune période, évaluation, note ou classe n'est supprimée.

alter table public.grade_periods
  add column if not exists scope_type text,
  add column if not exists education_type text,
  add column if not exists formation_code text,
  add column if not exists display_code text,
  add column if not exists profile_period_key text;

update public.grade_periods
set scope_type = 'common'
where scope_type is null or btrim(scope_type) = '';

update public.grade_periods
set display_code = code
where display_code is null;

alter table public.grade_periods
  alter column scope_type set default 'common';

alter table public.grade_periods
  alter column scope_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'grade_periods_scope_type_check'
      and conrelid = 'public.grade_periods'::regclass
  ) then
    alter table public.grade_periods
      add constraint grade_periods_scope_type_check
      check (scope_type in ('common', 'education', 'formation'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'grade_periods_education_type_check'
      and conrelid = 'public.grade_periods'::regclass
  ) then
    alter table public.grade_periods
      add constraint grade_periods_education_type_check
      check (
        education_type is null
        or education_type in (
          'general_secondary',
          'technical_secondary',
          'vocational_training',
          'higher_technical_short_cycle'
        )
      );
  end if;
end $$;

create index if not exists grade_periods_scope_lookup_idx
  on public.grade_periods (
    institution_id,
    academic_year,
    scope_type,
    education_type,
    formation_code,
    order_index
  );

create unique index if not exists grade_periods_profile_period_key_uidx
  on public.grade_periods (
    institution_id,
    academic_year,
    education_type,
    profile_period_key
  )
  where scope_type = 'education' and profile_period_key is not null;

comment on column public.grade_periods.scope_type is
  'common = découpage historique commun ; education = découpage propre à un type d’enseignement ; formation = extension future par filière.';
comment on column public.grade_periods.display_code is
  'Code lisible affiché dans l’interface ; grade_periods.code peut rester une clé technique unique.';

-- Matérialise les découpages spécifiques déjà enregistrés dans settings_json
-- afin qu'ils soient immédiatement utilisables par le cahier de notes après migration.
insert into public.grade_periods (
  institution_id,
  academic_year,
  code,
  display_code,
  label,
  short_label,
  kind,
  start_date,
  end_date,
  order_index,
  is_active,
  coeff,
  scope_type,
  education_type,
  formation_code,
  profile_period_key
)
select
  i.id,
  year_entry.key,
  left(
    'EDU_' || upper(substr(profile_entry.key, 1, 6)) || '_' ||
    substr(md5(coalesce(period_entry.value->>'id', period_entry.value->>'code', period_entry.ordinality::text)), 1, 10) || '_' ||
    regexp_replace(upper(coalesce(period_entry.value->>'code', 'P' || period_entry.ordinality::text)), '[^A-Z0-9]+', '_', 'g'),
    50
  ),
  coalesce(period_entry.value->>'code', 'P' || period_entry.ordinality::text),
  coalesce(period_entry.value->>'label', 'Période ' || period_entry.ordinality::text),
  coalesce(
    period_entry.value->>'short_label',
    period_entry.value->>'label',
    'Période ' || period_entry.ordinality::text
  ),
  nullif(period_entry.value->>'kind', ''),
  nullif(period_entry.value->>'start_date', '')::date,
  nullif(period_entry.value->>'end_date', '')::date,
  coalesce((period_entry.value->>'order_index')::integer, period_entry.ordinality::integer),
  coalesce((period_entry.value->>'is_active')::boolean, true),
  coalesce((period_entry.value->>'coeff')::numeric, 1),
  'education',
  profile_entry.key,
  null,
  coalesce(period_entry.value->>'id', period_entry.value->>'code', 'P' || period_entry.ordinality::text)
from public.institutions i
cross join lateral jsonb_each(
  coalesce(
    i.settings_json::jsonb -> 'education_parameter_profiles_v1' -> 'profiles',
    '{}'::jsonb
  )
) as profile_entry(key, value)
cross join lateral jsonb_each(
  coalesce(profile_entry.value -> 'gradingPeriodsByAcademicYear', '{}'::jsonb)
) as year_entry(key, value)
cross join lateral jsonb_array_elements(year_entry.value) with ordinality
  as period_entry(value, ordinality)
where profile_entry.key in (
  'technical_secondary',
  'vocational_training',
  'higher_technical_short_cycle'
)
  and coalesce((profile_entry.value->>'useCommonGradingPeriods')::boolean, true) = false
  and not exists (
    select 1
    from public.grade_periods gp
    where gp.institution_id = i.id
      and gp.academic_year = year_entry.key
      and gp.scope_type = 'education'
      and gp.education_type = profile_entry.key
      and gp.profile_period_key = coalesce(
        period_entry.value->>'id',
        period_entry.value->>'code',
        'P' || period_entry.ordinality::text
      )
  );
