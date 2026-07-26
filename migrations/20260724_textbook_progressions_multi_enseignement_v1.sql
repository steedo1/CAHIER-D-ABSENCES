-- =========================================================
-- Mon Cahier - Progressions pédagogiques multi-enseignement V1
-- Migration additive et idempotente.
-- Elle ne supprime aucune progression, aucun item et aucune affectation.
-- =========================================================

begin;

alter table public.textbook_progression_templates
  add column if not exists education_type text not null default 'general_secondary';

alter table public.textbook_progression_templates
  add column if not exists formation_code text;

alter table public.textbook_progression_templates
  add column if not exists formation_label text;

alter table public.textbook_progression_templates
  add column if not exists formation_level_code text;

alter table public.textbook_progression_templates
  add column if not exists formation_level_label text;

update public.textbook_progression_templates
set education_type = 'general_secondary'
where education_type is null or btrim(education_type) = '';

-- Reprendre le contexte des affectations déjà créées lorsque toutes les classes
-- d'une progression établissement pointent vers un seul contexte non général.
with progression_contexts as (
  select
    a.progression_id,
    min(coalesce(nullif(c.education_type, ''), 'general_secondary')) as education_type,
    min(nullif(c.formation_code, '')) as formation_code,
    min(nullif(c.formation_level_code, '')) as formation_level_code,
    count(distinct concat_ws(
      '::',
      coalesce(nullif(c.education_type, ''), 'general_secondary'),
      coalesce(c.formation_code, ''),
      coalesce(c.formation_level_code, '')
    )) as context_count
  from public.textbook_progression_class_assignments a
  join public.classes c on c.id = a.class_id
  where a.is_active = true
  group by a.progression_id
)
update public.textbook_progression_templates t
set
  education_type = pc.education_type,
  formation_code = pc.formation_code,
  formation_level_code = pc.formation_level_code,
  level = coalesce(pc.formation_level_code, t.level)
from progression_contexts pc
where t.id = pc.progression_id
  and t.scope = 'school'
  and pc.context_count = 1
  and pc.education_type <> 'general_secondary'
  and pc.formation_code is not null
  and pc.formation_level_code is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'textbook_progression_templates_education_type_check'
      and conrelid = 'public.textbook_progression_templates'::regclass
  ) then
    alter table public.textbook_progression_templates
      add constraint textbook_progression_templates_education_type_check
      check (
        education_type in (
          'general_secondary',
          'technical_secondary',
          'vocational_training',
          'higher_technical_short_cycle'
        )
      );
  end if;
end $$;

create index if not exists idx_textbook_templates_education_context
  on public.textbook_progression_templates (
    scope,
    education_type,
    formation_code,
    formation_level_code,
    academic_year,
    status
  );

comment on column public.textbook_progression_templates.education_type is
  'Type d’enseignement de la progression. Les anciennes progressions restent general_secondary.';
comment on column public.textbook_progression_templates.formation_code is
  'Code de la formation/filière pour les progressions hors secondaire général.';
comment on column public.textbook_progression_templates.formation_level_code is
  'Code de l’année de formation pour les progressions hors secondaire général.';

commit;

select
  education_type,
  formation_code,
  formation_level_code,
  scope,
  count(*) as nombre_progressions
from public.textbook_progression_templates
group by education_type, formation_code, formation_level_code, scope
order by scope, education_type, formation_code, formation_level_code;
