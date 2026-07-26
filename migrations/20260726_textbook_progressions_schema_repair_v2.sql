-- =========================================================
-- MON CAHIER — Réparation du schéma des progressions pédagogiques V2
-- Date : 2026-07-26
--
-- Objectifs :
--   1. rétablir les colonnes multi-enseignement si la migration V1 a été annulée ;
--   2. normaliser l'ancienne valeur erronée higher_short_cycle ;
--   3. recréer une contrainte cohérente avec classes et grade_periods ;
--   4. recharger le cache de schéma PostgREST/Supabase.
--
-- Migration additive, idempotente et sans suppression de données métier.
-- =========================================================

begin;

alter table public.textbook_progression_templates
  add column if not exists education_type text;

alter table public.textbook_progression_templates
  add column if not exists formation_code text;

alter table public.textbook_progression_templates
  add column if not exists formation_label text;

alter table public.textbook_progression_templates
  add column if not exists formation_level_code text;

alter table public.textbook_progression_templates
  add column if not exists formation_level_label text;

alter table public.textbook_progression_templates
  alter column education_type set default 'general_secondary';

-- Retirer d'abord une éventuelle contrainte V1 erronée. Sans cette étape,
-- la normalisation vers higher_technical_short_cycle pourrait être refusée.
alter table public.textbook_progression_templates
  drop constraint if exists textbook_progression_templates_education_type_check;

update public.textbook_progression_templates
set education_type = 'general_secondary'
where education_type is null or btrim(education_type) = '';

-- Compatibilité avec la valeur introduite par erreur dans la migration V1.
update public.textbook_progression_templates
set education_type = 'higher_technical_short_cycle'
where education_type = 'higher_short_cycle';

-- Le backfill est exécuté uniquement si la migration de contexte des classes
-- a déjà créé les trois colonnes nécessaires. Ainsi, cette réparation ne peut
-- pas être annulée à cause d'un ordre de migration incomplet.
do $repair$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name = 'education_type'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name = 'formation_code'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name = 'formation_level_code'
  ) then
    execute $backfill$
      with progression_contexts as (
        select
          a.progression_id,
          min(
            case
              when nullif(c.education_type, '') = 'higher_short_cycle'
                then 'higher_technical_short_cycle'
              else coalesce(nullif(c.education_type, ''), 'general_secondary')
            end
          ) as education_type,
          min(nullif(c.formation_code, '')) as formation_code,
          min(nullif(c.formation_level_code, '')) as formation_level_code,
          count(distinct concat_ws(
            '::',
            case
              when nullif(c.education_type, '') = 'higher_short_cycle'
                then 'higher_technical_short_cycle'
              else coalesce(nullif(c.education_type, ''), 'general_secondary')
            end,
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
        and pc.formation_level_code is not null
    $backfill$;
  end if;
end
$repair$;

-- Normalisation finale après le backfill.
update public.textbook_progression_templates
set education_type = 'higher_technical_short_cycle'
where education_type = 'higher_short_cycle';

-- Refuser explicitement toute valeur inconnue au lieu de masquer des données
-- incohérentes derrière une contrainte impossible à créer.
do $validation$
declare
  invalid_values text;
begin
  select string_agg(distinct education_type, ', ' order by education_type)
  into invalid_values
  from public.textbook_progression_templates
  where education_type not in (
    'general_secondary',
    'technical_secondary',
    'vocational_training',
    'higher_technical_short_cycle'
  );

  if invalid_values is not null then
    raise exception
      'Valeur(s) education_type non reconnue(s) dans textbook_progression_templates : %',
      invalid_values;
  end if;
end
$validation$;

alter table public.textbook_progression_templates
  alter column education_type set not null;

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
  'Type d’enseignement : general_secondary, technical_secondary, vocational_training ou higher_technical_short_cycle.';
comment on column public.textbook_progression_templates.formation_code is
  'Code de la formation/filière pour les progressions hors secondaire général.';
comment on column public.textbook_progression_templates.formation_level_code is
  'Code de l’année de formation pour les progressions hors secondaire général.';

-- Supabase/PostgREST doit oublier immédiatement l'ancien schéma en cache.
notify pgrst, 'reload schema';

commit;

-- Contrôles de fin de migration : les cinq colonnes doivent apparaître.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'textbook_progression_templates'
  and column_name in (
    'education_type',
    'formation_code',
    'formation_label',
    'formation_level_code',
    'formation_level_label'
  )
order by column_name;

select
  education_type,
  count(*) as nombre_progressions
from public.textbook_progression_templates
group by education_type
order by education_type;
