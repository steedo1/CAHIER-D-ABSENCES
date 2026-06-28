-- src/db/mon_cahier_ai_v37_student_longitudinal.sql
-- Mon Cahier IA v37 — Socle parcours élève longitudinal
-- Objectif : suivre le même élève sur plusieurs années, même s'il change de classe,
-- redouble, est admis, sort ou est transféré vers un autre établissement Mon Cahier.
-- Migration additive : ne supprime aucune donnée existante.

begin;

create extension if not exists pgcrypto;

-- 1) Identité pédagogique stable : regroupe plusieurs fiches "students" pouvant représenter
--    le même enfant dans le temps ou dans plusieurs établissements.
create table if not exists public.student_persons (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('MCP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  primary_institution_id uuid null references public.institutions(id) on delete set null,
  canonical_student_id uuid null,
  display_name text null,
  birthdate date null,
  identity_hint text null,
  identity_verified boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.student_persons is
  'Identité pédagogique stable d’un élève. Une même personne peut avoir plusieurs lignes students selon les établissements ou les années.';

comment on column public.student_persons.public_code is
  'Code interne non sensible permettant d’identifier un parcours élève dans Mon Cahier sans exposer directement l’ID technique.';

-- Fonction générique de mise à jour updated_at.
create or replace function public.mon_cahier_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_student_persons_touch_updated_at on public.student_persons;
create trigger trg_student_persons_touch_updated_at
before update on public.student_persons
for each row execute function public.mon_cahier_touch_updated_at();

-- 2) Relier la fiche élève actuelle à l'identité stable.
alter table public.students add column if not exists student_person_id uuid null;
alter table public.students add column if not exists lifecycle_status text null;
alter table public.students add column if not exists lifecycle_status_updated_at timestamptz null;
alter table public.students add column if not exists transfer_code text null;
alter table public.students add column if not exists transferred_from_institution_id uuid null;
alter table public.students add column if not exists transferred_to_institution_id uuid null;
alter table public.students add column if not exists exit_date date null;
alter table public.students add column if not exists exit_reason text null;

update public.students
set lifecycle_status = 'active'
where lifecycle_status is null;

alter table public.students alter column lifecycle_status set default 'active';

-- Contraintes ajoutées seulement si absentes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'students_student_person_id_fkey'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
      add constraint students_student_person_id_fkey
      foreign key (student_person_id) references public.student_persons(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'students_lifecycle_status_chk'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
      add constraint students_lifecycle_status_chk
      check (lifecycle_status in (
        'active',
        'promoted',
        'repeated',
        'transferred_out',
        'transferred_in',
        'exited',
        'archived',
        'duplicate_merged'
      ));
  end if;
end $$;

create index if not exists idx_students_student_person_id
  on public.students(student_person_id);

create index if not exists idx_students_lifecycle_status
  on public.students(institution_id, lifecycle_status);

create unique index if not exists idx_students_transfer_code_unique
  on public.students(transfer_code)
  where transfer_code is not null;

comment on column public.students.student_person_id is
  'Lien vers l’identité pédagogique stable permettant de suivre un élève sur plusieurs années ou établissements.';
comment on column public.students.lifecycle_status is
  'Statut de parcours : active, promoted, repeated, transferred_out, transferred_in, exited, archived, duplicate_merged.';
comment on column public.students.transfer_code is
  'Code de transfert généré lorsqu’un dossier doit être récupéré par un autre établissement Mon Cahier après validation.';

-- Backfill : une identité stable par élève existant non encore relié.
do $$
declare
  r record;
  v_person_id uuid;
  v_name text;
begin
  for r in
    select s.id,
           s.institution_id,
           s.first_name,
           s.last_name,
           s.full_name,
           s.birthdate
    from public.students s
    where s.student_person_id is null
  loop
    v_name := nullif(trim(coalesce(r.full_name, '') || ' ' || coalesce(r.last_name, '') || ' ' || coalesce(r.first_name, '')), '');

    insert into public.student_persons (
      primary_institution_id,
      canonical_student_id,
      display_name,
      birthdate,
      identity_hint,
      metadata_json
    ) values (
      r.institution_id,
      r.id,
      v_name,
      r.birthdate,
      lower(regexp_replace(coalesce(v_name, '') || '|' || coalesce(r.birthdate::text, ''), '\s+', ' ', 'g')),
      jsonb_build_object('created_by_migration', 'mon_cahier_ai_v37_student_longitudinal')
    )
    returning id into v_person_id;

    update public.students
    set student_person_id = v_person_id,
        lifecycle_status_updated_at = coalesce(lifecycle_status_updated_at, now())
    where id = r.id;
  end loop;
end $$;

-- 3) Événements de parcours : changement de classe, promotion, redoublement, transfert, sortie.
create table if not exists public.student_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  student_person_id uuid null references public.student_persons(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text null,
  event_type text not null,
  event_date date not null default current_date,
  from_class_id uuid null references public.classes(id) on delete set null,
  to_class_id uuid null references public.classes(id) on delete set null,
  from_institution_id uuid null references public.institutions(id) on delete set null,
  to_institution_id uuid null references public.institutions(id) on delete set null,
  decision_id uuid null,
  transfer_id uuid null,
  reason text null,
  details_json jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_lifecycle_events_event_type_chk'
      and conrelid = 'public.student_lifecycle_events'::regclass
  ) then
    alter table public.student_lifecycle_events
      add constraint student_lifecycle_events_event_type_chk
      check (event_type in (
        'initial_assignment',
        'class_change',
        'promotion',
        'repeat',
        'decision',
        'transfer_requested',
        'transfer_out',
        'transfer_in',
        'exit',
        'archive',
        'reactivation',
        'duplicate_merge',
        'correction'
      ));
  end if;
end $$;

create index if not exists idx_student_lifecycle_events_student
  on public.student_lifecycle_events(student_id, event_date desc);

create index if not exists idx_student_lifecycle_events_person
  on public.student_lifecycle_events(student_person_id, event_date desc);

create index if not exists idx_student_lifecycle_events_school_year
  on public.student_lifecycle_events(institution_id, academic_year, event_date desc);

comment on table public.student_lifecycle_events is
  'Journal chronologique du parcours élève : changement de classe, promotion, redoublement, transfert, sortie, fusion.';

-- 4) Décisions annuelles : admis, redouble, orienté, transféré, sorti.
create table if not exists public.student_year_decisions (
  id uuid primary key default gen_random_uuid(),
  student_person_id uuid null references public.student_persons(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  current_class_id uuid null references public.classes(id) on delete set null,
  decision_type text not null default 'pending',
  decision_label text null,
  next_academic_year text null,
  next_class_id uuid null references public.classes(id) on delete set null,
  next_institution_id uuid null references public.institutions(id) on delete set null,
  is_repeater_next_year boolean null,
  decided_at timestamptz null,
  decided_by uuid null references public.profiles(id) on delete set null,
  notes text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, student_id, academic_year)
);

drop trigger if exists trg_student_year_decisions_touch_updated_at on public.student_year_decisions;
create trigger trg_student_year_decisions_touch_updated_at
before update on public.student_year_decisions
for each row execute function public.mon_cahier_touch_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_year_decisions_decision_type_chk'
      and conrelid = 'public.student_year_decisions'::regclass
  ) then
    alter table public.student_year_decisions
      add constraint student_year_decisions_decision_type_chk
      check (decision_type in (
        'pending',
        'admitted',
        'promoted',
        'repeated',
        'oriented',
        'transferred',
        'exited',
        'excluded',
        'other'
      ));
  end if;
end $$;

create index if not exists idx_student_year_decisions_person
  on public.student_year_decisions(student_person_id, academic_year desc);

create index if not exists idx_student_year_decisions_school_year
  on public.student_year_decisions(institution_id, academic_year, decision_type);

comment on table public.student_year_decisions is
  'Décision de fin ou cours d’année pour une inscription élève : admis, promu, redouble, transféré, sorti, orienté.';

-- 5) Transfert entre établissements Mon Cahier : demande, validation, réception.
create table if not exists public.student_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  transfer_code text not null unique default ('MCT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14))),
  student_person_id uuid null references public.student_persons(id) on delete set null,
  from_student_id uuid not null references public.students(id) on delete cascade,
  to_student_id uuid null references public.students(id) on delete set null,
  from_institution_id uuid not null references public.institutions(id) on delete cascade,
  to_institution_id uuid null references public.institutions(id) on delete set null,
  academic_year text null,
  status text not null default 'draft',
  data_scope_json jsonb not null default '{"identity": true, "bulletins": true, "attendance": true, "conduct": true, "remediation": true}'::jsonb,
  requested_by uuid null references public.profiles(id) on delete set null,
  approved_by uuid null references public.profiles(id) on delete set null,
  received_by uuid null references public.profiles(id) on delete set null,
  requested_at timestamptz null,
  approved_at timestamptz null,
  received_at timestamptz null,
  expires_at timestamptz null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_student_transfer_requests_touch_updated_at on public.student_transfer_requests;
create trigger trg_student_transfer_requests_touch_updated_at
before update on public.student_transfer_requests
for each row execute function public.mon_cahier_touch_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_transfer_requests_status_chk'
      and conrelid = 'public.student_transfer_requests'::regclass
  ) then
    alter table public.student_transfer_requests
      add constraint student_transfer_requests_status_chk
      check (status in (
        'draft',
        'requested',
        'approved',
        'received',
        'rejected',
        'cancelled',
        'expired'
      ));
  end if;
end $$;

create index if not exists idx_student_transfer_requests_from
  on public.student_transfer_requests(from_institution_id, status, created_at desc);

create index if not exists idx_student_transfer_requests_to
  on public.student_transfer_requests(to_institution_id, status, created_at desc);

create index if not exists idx_student_transfer_requests_person
  on public.student_transfer_requests(student_person_id, created_at desc);

comment on table public.student_transfer_requests is
  'Demandes contrôlées de transfert de dossier élève entre établissements Mon Cahier.';

-- 6) Plans de remédiation persistants : indispensable pour apprendre ensuite quelles actions fonctionnent.
create table if not exists public.ai_remediation_plans (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  class_id uuid null references public.classes(id) on delete set null,
  title text not null default 'Plan de remédiation ciblé',
  source text not null default 'mon_cahier_ia',
  source_run_id uuid null references public.ai_prediction_runs(id) on delete set null,
  scope_label text null,
  status text not null default 'draft',
  created_by uuid null references public.profiles(id) on delete set null,
  validated_by uuid null references public.profiles(id) on delete set null,
  validated_at timestamptz null,
  answer_snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ai_remediation_plans_touch_updated_at on public.ai_remediation_plans;
create trigger trg_ai_remediation_plans_touch_updated_at
before update on public.ai_remediation_plans
for each row execute function public.mon_cahier_touch_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_remediation_plans_status_chk'
      and conrelid = 'public.ai_remediation_plans'::regclass
  ) then
    alter table public.ai_remediation_plans
      add constraint ai_remediation_plans_status_chk
      check (status in ('draft', 'validated', 'in_progress', 'closed', 'cancelled'));
  end if;
end $$;

create index if not exists idx_ai_remediation_plans_school_year
  on public.ai_remediation_plans(institution_id, academic_year, created_at desc);

create table if not exists public.ai_remediation_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ai_remediation_plans(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  action_label text not null,
  target_label text null,
  student_person_ids uuid[] not null default '{}'::uuid[],
  student_ids uuid[] not null default '{}'::uuid[],
  class_id uuid null references public.classes(id) on delete set null,
  subject_id uuid null references public.subjects(id) on delete set null,
  subject_name text null,
  responsible_label text null,
  due_label text null,
  due_date date null,
  priority text not null default 'medium',
  status text not null default 'todo',
  notes text null,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ai_remediation_plan_items_touch_updated_at on public.ai_remediation_plan_items;
create trigger trg_ai_remediation_plan_items_touch_updated_at
before update on public.ai_remediation_plan_items
for each row execute function public.mon_cahier_touch_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_remediation_plan_items_priority_chk'
      and conrelid = 'public.ai_remediation_plan_items'::regclass
  ) then
    alter table public.ai_remediation_plan_items
      add constraint ai_remediation_plan_items_priority_chk
      check (priority in ('low', 'medium', 'high', 'critical'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_remediation_plan_items_status_chk'
      and conrelid = 'public.ai_remediation_plan_items'::regclass
  ) then
    alter table public.ai_remediation_plan_items
      add constraint ai_remediation_plan_items_status_chk
      check (status in ('todo', 'in_progress', 'done', 'to_check', 'to_decide', 'observing', 'cancelled'));
  end if;
end $$;

create index if not exists idx_ai_remediation_plan_items_plan
  on public.ai_remediation_plan_items(plan_id, status);

create index if not exists idx_ai_remediation_plan_items_school_year
  on public.ai_remediation_plan_items(institution_id, academic_year, status, due_date);

create index if not exists idx_ai_remediation_plan_items_student_ids
  on public.ai_remediation_plan_items using gin(student_ids);

comment on table public.ai_remediation_plans is
  'Plan IA validable par l’administration : photographie exploitable avant ou après conseil.';
comment on table public.ai_remediation_plan_items is
  'Actions opérationnelles du plan : responsable, échéance, statut, élèves concernés, matière, résultat.';

-- 7) Résultat après action : matière première future pour entraîner le modèle.
create table if not exists public.ai_remediation_item_outcomes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.ai_remediation_plan_items(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  outcome_date date not null default current_date,
  outcome_type text not null default 'review',
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  improved boolean null,
  improvement_note text null,
  recorded_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_remediation_item_outcomes_type_chk'
      and conrelid = 'public.ai_remediation_item_outcomes'::regclass
  ) then
    alter table public.ai_remediation_item_outcomes
      add constraint ai_remediation_item_outcomes_type_chk
      check (outcome_type in ('review', 'next_evaluation', 'period_end', 'manual_followup', 'council_decision'));
  end if;
end $$;

create index if not exists idx_ai_remediation_item_outcomes_item
  on public.ai_remediation_item_outcomes(item_id, outcome_date desc);

create index if not exists idx_ai_remediation_item_outcomes_school_year
  on public.ai_remediation_item_outcomes(institution_id, academic_year, outcome_date desc);

-- 8) Enrichir les échantillons d’entraînement IA avec la notion de parcours.
alter table public.ai_training_samples add column if not exists student_person_id uuid null references public.student_persons(id) on delete set null;
alter table public.ai_training_samples add column if not exists enrollment_id uuid null references public.class_enrollments(id) on delete set null;
alter table public.ai_training_samples add column if not exists period_code text null;
alter table public.ai_training_samples add column if not exists source_plan_item_id uuid null references public.ai_remediation_plan_items(id) on delete set null;
alter table public.ai_training_samples add column if not exists outcome_window text null;

create index if not exists idx_ai_training_samples_person
  on public.ai_training_samples(institution_id, student_person_id, academic_year);

create index if not exists idx_ai_training_samples_outcome_source
  on public.ai_training_samples(source_plan_item_id)
  where source_plan_item_id is not null;

-- Backfill student_person_id dans les samples existants.
update public.ai_training_samples ats
set student_person_id = s.student_person_id
from public.students s
where ats.student_id = s.id
  and ats.student_person_id is null;

-- 9) Vues de contrôle pour l’administration et pour préparer le futur dataset ML.
create or replace view public.v_student_longitudinal_enrollments as
select
  sp.id as student_person_id,
  sp.public_code as student_public_code,
  sp.display_name as person_display_name,
  s.id as student_id,
  s.institution_id,
  s.lifecycle_status,
  s.matricule,
  coalesce(nullif(trim(coalesce(s.full_name, '')), ''), nullif(trim(coalesce(s.last_name, '') || ' ' || coalesce(s.first_name, '')), '')) as student_name,
  s.birthdate,
  ce.id as enrollment_id,
  ce.start_date,
  ce.end_date,
  c.id as class_id,
  c.label as class_label,
  c.level as class_level,
  c.academic_year,
  case when ce.id is not null and ce.end_date is null then true else false end as is_current_enrollment
from public.student_persons sp
join public.students s on s.student_person_id = sp.id
left join public.class_enrollments ce on ce.student_id = s.id
left join public.classes c on c.id = ce.class_id;

create or replace view public.v_student_longitudinal_timeline as
select
  'enrollment'::text as source_type,
  coalesce(ce.start_date, current_date)::date as event_date,
  s.student_person_id,
  s.id as student_id,
  s.institution_id,
  c.academic_year,
  c.id as class_id,
  c.label as class_label,
  c.level as class_level,
  case when ce.end_date is null then 'inscription_active' else 'inscription_cloturee' end as event_type,
  jsonb_build_object('enrollment_id', ce.id, 'start_date', ce.start_date, 'end_date', ce.end_date) as details_json
from public.class_enrollments ce
join public.students s on s.id = ce.student_id
left join public.classes c on c.id = ce.class_id

union all

select
  'lifecycle_event'::text as source_type,
  e.event_date,
  e.student_person_id,
  e.student_id,
  e.institution_id,
  e.academic_year,
  coalesce(e.to_class_id, e.from_class_id) as class_id,
  c.label as class_label,
  c.level as class_level,
  e.event_type,
  e.details_json || jsonb_build_object('reason', e.reason) as details_json
from public.student_lifecycle_events e
left join public.classes c on c.id = coalesce(e.to_class_id, e.from_class_id)

union all

select
  'decision'::text as source_type,
  coalesce(d.decided_at::date, d.updated_at::date, d.created_at::date) as event_date,
  d.student_person_id,
  d.student_id,
  d.institution_id,
  d.academic_year,
  d.current_class_id as class_id,
  c.label as class_label,
  c.level as class_level,
  d.decision_type as event_type,
  jsonb_build_object(
    'decision_label', d.decision_label,
    'next_academic_year', d.next_academic_year,
    'next_class_id', d.next_class_id,
    'next_institution_id', d.next_institution_id,
    'notes', d.notes
  ) as details_json
from public.student_year_decisions d
left join public.classes c on c.id = d.current_class_id;

comment on view public.v_student_longitudinal_enrollments is
  'Vue de contrôle : parcours d’inscription d’un élève, classe par classe, année par année.';
comment on view public.v_student_longitudinal_timeline is
  'Timeline unifiée : inscriptions, décisions et événements de parcours.';

-- 10) RLS : les routes serveur de Mon Cahier utilisent le service role. Pas d’exposition directe côté client.
alter table public.student_persons enable row level security;
alter table public.student_lifecycle_events enable row level security;
alter table public.student_year_decisions enable row level security;
alter table public.student_transfer_requests enable row level security;
alter table public.ai_remediation_plans enable row level security;
alter table public.ai_remediation_plan_items enable row level security;
alter table public.ai_remediation_item_outcomes enable row level security;

commit;
