-- src/db/mon_cahier_ai_v2.sql
-- Mon Cahier IA v2 - SQL compatible v1 -> v2
-- Objectif : installer/mettre à jour les tables IA sans casser une base où la v1 existe déjà.
-- À exécuter dans Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.ai_model_versions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid null,
  model_key text not null default 'mon_cahier_ai_pedagogy',
  model_version text not null,
  model_kind text not null default 'pedagogical_risk',
  status text not null default 'draft',
  training_started_at timestamptz null,
  training_finished_at timestamptz null,
  training_rows_count integer null,
  features_json jsonb not null default '[]'::jsonb,
  metrics_json jsonb not null default '{}'::jsonb,
  storage_path text null,
  notes text null,
  created_at timestamptz not null default now(),
  unique (institution_id, model_key, model_version)
);

create table if not exists public.ai_training_samples (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null,
  academic_year text not null,
  snapshot_date date not null default current_date,
  class_id uuid not null,
  student_id uuid not null,
  model_key text not null default 'mon_cahier_ai_pedagogy',
  features_json jsonb not null default '{}'::jsonb,
  label_json jsonb not null default '{}'::jsonb,
  is_usable boolean not null default true,
  exclusion_reason text null,
  created_at timestamptz not null default now(),
  unique (institution_id, academic_year, snapshot_date, class_id, student_id, model_key)
);

create table if not exists public.ai_prediction_runs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null,
  academic_year text not null,
  class_id uuid null,
  requested_by uuid null,
  model_key text not null default 'mon_cahier_ai_pedagogy',
  model_version text not null default '2.0.0',
  model_source text not null default 'rules_baseline',
  question text null,
  intent text null,
  exam_date date null,
  core_completion_percent numeric(5,2) null,
  classes_count integer not null default 0,
  students_count integer not null default 0,
  warnings_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Compatibilité avec la v1 : create table if not exists ne modifie pas une table déjà créée.
alter table public.ai_prediction_runs add column if not exists requested_by uuid null;
alter table public.ai_prediction_runs add column if not exists question text null;
alter table public.ai_prediction_runs add column if not exists intent text null;
alter table public.ai_prediction_runs add column if not exists core_completion_percent numeric(5,2) null;
alter table public.ai_prediction_runs add column if not exists classes_count integer not null default 0;
alter table public.ai_prediction_runs add column if not exists students_count integer not null default 0;
alter table public.ai_prediction_runs add column if not exists warnings_json jsonb not null default '[]'::jsonb;

-- La v1 avait une contrainte qui refusait rules_baseline.
alter table public.ai_prediction_runs drop constraint if exists ai_prediction_runs_source_check;
alter table public.ai_prediction_runs
  add constraint ai_prediction_runs_source_check check (
    model_source in ('sql_baseline', 'rules_baseline', 'ml_service', 'hybrid', 'manual_review')
  );

create table if not exists public.ai_prediction_students (
  id uuid primary key default gen_random_uuid(),
  run_id uuid null,
  prediction_run_id uuid null,
  institution_id uuid not null,
  academic_year text not null,
  class_id uuid null,
  student_id uuid null,
  predicted_success numeric(7,4) null,
  risk_level text null,
  risk_label text null,
  general_avg_20 numeric(5,2) null,
  priority_score integer null,
  features_json jsonb not null default '{}'::jsonb,
  reasons_json jsonb not null default '[]'::jsonb,
  recommendation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Compatibilité v1/v2 sur ai_prediction_students.
alter table public.ai_prediction_students add column if not exists run_id uuid null;
alter table public.ai_prediction_students add column if not exists prediction_run_id uuid null;
alter table public.ai_prediction_students add column if not exists risk_level text null;
alter table public.ai_prediction_students add column if not exists risk_label text null;
alter table public.ai_prediction_students add column if not exists priority_score integer null;
alter table public.ai_prediction_students add column if not exists reasons_json jsonb not null default '[]'::jsonb;
alter table public.ai_prediction_students add column if not exists recommendation_json jsonb not null default '{}'::jsonb;
alter table public.ai_prediction_students add column if not exists general_avg_20 numeric(5,2) null;

-- Backfill des anciennes lignes v1.
update public.ai_prediction_students
set run_id = prediction_run_id
where run_id is null and prediction_run_id is not null;

update public.ai_prediction_students
set prediction_run_id = run_id
where prediction_run_id is null and run_id is not null;

update public.ai_prediction_students
set risk_level = risk_label
where risk_level is null and risk_label is not null;

update public.ai_prediction_students
set risk_label = risk_level
where risk_label is null and risk_level is not null;

-- Les deux colonnes restent synchronisées pour accepter l'ancien code et le nouveau code.
create or replace function public.ai_prediction_students_sync_run_ids()
returns trigger
language plpgsql
as $$
begin
  if new.run_id is null and new.prediction_run_id is not null then
    new.run_id := new.prediction_run_id;
  end if;

  if new.prediction_run_id is null and new.run_id is not null then
    new.prediction_run_id := new.run_id;
  end if;

  if new.risk_level is null and new.risk_label is not null then
    new.risk_level := new.risk_label;
  end if;

  if new.risk_label is null and new.risk_level is not null then
    new.risk_label := new.risk_level;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ai_prediction_students_sync_run_ids on public.ai_prediction_students;
create trigger trg_ai_prediction_students_sync_run_ids
before insert or update of run_id, prediction_run_id, risk_level, risk_label
on public.ai_prediction_students
for each row execute function public.ai_prediction_students_sync_run_ids();

-- Ajout des clés étrangères uniquement si elles n'existent pas déjà.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_prediction_students_run_id_fkey'
      and conrelid = 'public.ai_prediction_students'::regclass
  ) then
    alter table public.ai_prediction_students
      add constraint ai_prediction_students_run_id_fkey
      foreign key (run_id) references public.ai_prediction_runs(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_prediction_students_prediction_run_id_fkey'
      and conrelid = 'public.ai_prediction_students'::regclass
  ) then
    alter table public.ai_prediction_students
      add constraint ai_prediction_students_prediction_run_id_fkey
      foreign key (prediction_run_id) references public.ai_prediction_runs(id) on delete cascade;
  end if;
end;
$$;

create table if not exists public.ai_prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null,
  academic_year text not null,
  class_id uuid null,
  student_id uuid null,
  model_key text not null default 'mon_cahier_ai_pedagogy',
  period_code text null,
  final_average_20 numeric(5,2) null,
  passed boolean null,
  decision text null,
  outcome_json jsonb not null default '{}'::jsonb,
  recorded_by uuid null,
  recorded_at timestamptz not null default now()
);

alter table public.ai_prediction_outcomes add column if not exists model_key text not null default 'mon_cahier_ai_pedagogy';
alter table public.ai_prediction_outcomes add column if not exists period_code text null;
alter table public.ai_prediction_outcomes add column if not exists outcome_json jsonb not null default '{}'::jsonb;

create table if not exists public.ai_assistant_interactions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null,
  user_id uuid null,
  academic_year text not null,
  question text not null,
  intent text null,
  model_key text not null default 'mon_cahier_ai_pedagogy',
  model_version text not null default '2.0.0',
  model_source text not null default 'rules_baseline',
  confidence integer null,
  answer_json jsonb not null default '{}'::jsonb,
  context_summary_json jsonb not null default '{}'::jsonb,
  user_feedback text null,
  user_rating integer null check (user_rating is null or (user_rating >= 1 and user_rating <= 5)),
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_training_samples_school_year
  on public.ai_training_samples(institution_id, academic_year, snapshot_date);

create index if not exists idx_ai_training_samples_student
  on public.ai_training_samples(institution_id, student_id, academic_year);

create index if not exists idx_ai_prediction_runs_school_year
  on public.ai_prediction_runs(institution_id, academic_year, created_at desc);

create index if not exists idx_ai_prediction_students_run_any
  on public.ai_prediction_students((coalesce(run_id, prediction_run_id)));

create index if not exists idx_ai_prediction_students_student_v2
  on public.ai_prediction_students(institution_id, student_id, academic_year);

create index if not exists idx_ai_outcomes_student
  on public.ai_prediction_outcomes(institution_id, student_id, academic_year);

create unique index if not exists uq_ai_prediction_outcomes_scope
  on public.ai_prediction_outcomes(institution_id, academic_year, class_id, student_id, model_key, coalesce(period_code, 'annual'));

create index if not exists idx_ai_assistant_interactions_school_year
  on public.ai_assistant_interactions(institution_id, academic_year, created_at desc);


-- PostgreSQL ne permet pas toujours de modifier la structure/ordre des colonnes
-- d'une vue existante avec CREATE OR REPLACE VIEW.
-- On supprime donc les vues IA avant de les recréer proprement.
drop view if exists public.v_ai_latest_student_predictions;
drop view if exists public.v_ai_latest_prediction_students;
drop view if exists public.v_ai_latest_model_versions;

create or replace view public.v_ai_latest_model_versions as
select distinct on (institution_id, model_key)
  id,
  institution_id,
  model_key,
  model_version,
  model_kind,
  status,
  training_rows_count,
  metrics_json,
  storage_path,
  created_at
from public.ai_model_versions
where status in ('active', 'validated', 'production')
order by institution_id, model_key, created_at desc;

create or replace view public.v_ai_latest_student_predictions as
select distinct on (aps.institution_id, aps.academic_year, aps.student_id)
  aps.*,
  apr.model_key,
  apr.model_version,
  apr.model_source,
  apr.question,
  apr.intent,
  apr.exam_date,
  apr.created_at as run_created_at
from public.ai_prediction_students aps
join public.ai_prediction_runs apr on apr.id = coalesce(aps.run_id, aps.prediction_run_id)
order by aps.institution_id, aps.academic_year, aps.student_id, apr.created_at desc;

-- Vue historique v1 conservée, mais rendue compatible si elle existe dans le code.
create or replace view public.v_ai_latest_prediction_students as
select distinct on (aps.institution_id, aps.student_id, aps.academic_year)
  aps.*,
  apr.model_key,
  apr.model_version,
  apr.model_source,
  apr.exam_date,
  apr.created_at as run_created_at
from public.ai_prediction_students aps
join public.ai_prediction_runs apr on apr.id = coalesce(aps.run_id, aps.prediction_run_id)
order by aps.institution_id, aps.student_id, aps.academic_year, apr.created_at desc;

alter table public.ai_model_versions enable row level security;
alter table public.ai_training_samples enable row level security;
alter table public.ai_prediction_runs enable row level security;
alter table public.ai_prediction_students enable row level security;
alter table public.ai_prediction_outcomes enable row level security;
alter table public.ai_assistant_interactions enable row level security;

comment on table public.ai_prediction_runs is
  'Mon Cahier IA : historise chaque analyse prédictive ou interaction assistant.';
comment on table public.ai_prediction_students is
  'Mon Cahier IA : snapshot élève par élève pour expliquer les indices de suivi, compatible v1/v2.';
comment on table public.ai_prediction_outcomes is
  'Mon Cahier IA : résultats réels à renseigner plus tard pour mesurer la précision du modèle.';
comment on table public.ai_assistant_interactions is
  'Mon Cahier IA : historique des questions libres et réponses de l’assistant pédagogique.';
comment on table public.ai_model_versions is
  'Mon Cahier IA : versionnement des modèles entraînés ou validés.';
comment on table public.ai_training_samples is
  'Mon Cahier IA : échantillons d’entraînement anonymisables pour le modèle ML.';
