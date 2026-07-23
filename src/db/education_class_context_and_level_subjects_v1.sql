-- MON CAHIER — Contexte pédagogique des classes et matières par niveau
-- Migration additive et réversible.

begin;

alter table public.classes
  add column if not exists education_type text,
  add column if not exists formation_code text,
  add column if not exists formation_level_code text;

comment on column public.classes.education_type is
  'Type d’enseignement Mon Cahier : general_secondary, technical_secondary, vocational_training ou higher_technical_short_cycle.';
comment on column public.classes.formation_code is
  'Clé stable de la formation choisie dans Organisation pédagogique (catalog:... ou custom:...).';
comment on column public.classes.formation_level_code is
  'Code interne du niveau de formation, distinct du libellé visible de la classe.';

alter table public.classes
  drop constraint if exists classes_education_type_check;

alter table public.classes
  add constraint classes_education_type_check
  check (
    education_type is null
    or education_type in (
      'general_secondary',
      'technical_secondary',
      'vocational_training',
      'higher_technical_short_cycle'
    )
  );

create index if not exists classes_education_context_idx
  on public.classes (institution_id, academic_year, education_type, formation_code, formation_level_code);

-- Backfill prudent : seules les classes possédant déjà une série générale officielle
-- sont marquées comme secondaire général. Aucune classe technique/professionnelle
-- existante n’est reclassée arbitrairement.
update public.classes
set
  education_type = coalesce(education_type, 'general_secondary'),
  formation_level_code = coalesce(formation_level_code, official_track_code)
where official_track_code is not null
  and (education_type is null or formation_level_code is null);

create table if not exists public.institution_level_subjects (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  education_type text not null,
  formation_code text not null,
  level_code text not null,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  order_index integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint institution_level_subjects_education_type_check
    check (
      education_type in (
        'technical_secondary',
        'vocational_training',
        'higher_technical_short_cycle'
      )
    ),
  constraint institution_level_subjects_unique
    unique (institution_id, education_type, formation_code, level_code, subject_id)
);

comment on table public.institution_level_subjects is
  'Association des disciplines aux niveaux des formations techniques, professionnelles et BTS. Les matières générales continuent d’utiliser le fonctionnement historique.';

create index if not exists institution_level_subjects_context_idx
  on public.institution_level_subjects (
    institution_id,
    education_type,
    formation_code,
    level_code,
    is_active,
    order_index
  );

create index if not exists institution_level_subjects_subject_idx
  on public.institution_level_subjects (institution_id, subject_id);

alter table public.institution_level_subjects enable row level security;

-- Les écritures passent par les routes serveur utilisant la clé de service.
-- L’absence volontaire de policy empêche un accès direct non contrôlé depuis le navigateur.

commit;
