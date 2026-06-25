-- src/db/mon_cahier_ai_v1.sql
-- Mon Cahier IA v1 : historisation des prédictions, analyses IA et résultats réels.
-- À exécuter une seule fois dans Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.ai_prediction_runs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  class_id uuid null references public.classes(id) on delete set null,
  academic_year text not null,
  exam_date date null,
  model_key text not null default 'mon_cahier_ai_pedagogique',
  model_version text not null default '2026.06-v1',
  model_source text not null default 'sql_baseline',
  class_size integer null,
  class_predicted_success_rate numeric(6,2) null,
  input_json jsonb not null default '{}'::jsonb,
  metrics_json jsonb not null default '{}'::jsonb,
  recommendations_json jsonb not null default '[]'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint ai_prediction_runs_source_check check (
    model_source in ('sql_baseline', 'ml_service', 'hybrid', 'manual_review')
  )
);

create index if not exists idx_ai_prediction_runs_institution_year
  on public.ai_prediction_runs(institution_id, academic_year, created_at desc);

create index if not exists idx_ai_prediction_runs_class
  on public.ai_prediction_runs(class_id, created_at desc);

create table if not exists public.ai_prediction_students (
  id uuid primary key default gen_random_uuid(),
  prediction_run_id uuid not null references public.ai_prediction_runs(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  class_id uuid null references public.classes(id) on delete set null,
  academic_year text not null,
  student_id uuid null references public.students(id) on delete set null,
  predicted_success numeric(6,2) null,
  risk_label text null,
  general_avg_20 numeric(5,2) null,
  features_json jsonb not null default '{}'::jsonb,
  recommendation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_prediction_students_run
  on public.ai_prediction_students(prediction_run_id);

create index if not exists idx_ai_prediction_students_student
  on public.ai_prediction_students(student_id, created_at desc);

create index if not exists idx_ai_prediction_students_institution_year
  on public.ai_prediction_students(institution_id, academic_year, created_at desc);

create table if not exists public.ai_prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  prediction_student_id uuid null references public.ai_prediction_students(id) on delete cascade,
  student_id uuid null references public.students(id) on delete set null,
  class_id uuid null references public.classes(id) on delete set null,
  academic_year text not null,
  outcome_label text null,
  final_average_20 numeric(5,2) null,
  passed boolean null,
  decision text null,
  recorded_by uuid null,
  recorded_at timestamptz not null default now(),
  notes text null
);

create index if not exists idx_ai_prediction_outcomes_institution_year
  on public.ai_prediction_outcomes(institution_id, academic_year, recorded_at desc);

create index if not exists idx_ai_prediction_outcomes_student
  on public.ai_prediction_outcomes(student_id, academic_year);

create table if not exists public.ai_insight_runs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  action text not null,
  model_key text not null default 'mon_cahier_ai_pedagogique',
  model_version text not null default '2026.06-v1',
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint ai_insight_runs_action_check check (
    action in (
      'students_to_follow',
      'class_decline_risk',
      'blocking_subjects',
      'school_summary',
      'council_note',
      'remediation_plan'
    )
  )
);

create index if not exists idx_ai_insight_runs_institution
  on public.ai_insight_runs(institution_id, created_at desc);

create table if not exists public.ai_model_evaluations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  model_key text not null default 'mon_cahier_ai_pedagogique',
  model_version text not null default '2026.06-v1',
  evaluated_at timestamptz not null default now(),
  sample_size integer not null default 0,
  accuracy numeric(6,2) null,
  precision_high_risk numeric(6,2) null,
  recall_high_risk numeric(6,2) null,
  false_negative_count integer not null default 0,
  false_positive_count integer not null default 0,
  metrics_json jsonb not null default '{}'::jsonb,
  created_by uuid null
);

create index if not exists idx_ai_model_evaluations_institution_year
  on public.ai_model_evaluations(institution_id, academic_year, evaluated_at desc);

create or replace view public.v_ai_latest_prediction_students as
select distinct on (s.institution_id, s.student_id, s.academic_year)
  s.*,
  r.model_key,
  r.model_version,
  r.model_source,
  r.exam_date,
  r.created_at as run_created_at
from public.ai_prediction_students s
join public.ai_prediction_runs r on r.id = s.prediction_run_id
order by s.institution_id, s.student_id, s.academic_year, r.created_at desc;

comment on table public.ai_prediction_runs is
  'Mon Cahier IA : historise chaque analyse prédictive lancée sur une classe.';
comment on table public.ai_prediction_students is
  'Mon Cahier IA : snapshot élève par élève pour expliquer les indices de suivi.';
comment on table public.ai_prediction_outcomes is
  'Mon Cahier IA : résultats réels à renseigner plus tard pour mesurer la précision du modèle.';
comment on table public.ai_insight_runs is
  'Mon Cahier IA : historique des questions intelligentes posées par l’administration.';
comment on table public.ai_model_evaluations is
  'Mon Cahier IA : suivi qualité du modèle, précision, rappel et erreurs.';
