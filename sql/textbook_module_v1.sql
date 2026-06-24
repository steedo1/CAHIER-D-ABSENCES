-- =========================================================
-- Mon Cahier - Module Cahier de texte / Progressions V1
-- Objectif : progressions officielles par discipline/niveau/classe,
-- séances réalisées par les enseignants, leçons terminées et statistiques.
-- Script idempotent : ne supprime aucune donnée existante.
-- =========================================================

begin;

create extension if not exists pgcrypto;

-- Bucket privé pour stocker les documents officiels de progression.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'progressions',
      'progressions',
      false,
      26214400,
      array[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      ]
    )
    on conflict (id) do nothing;
  end if;
end $$;

create table if not exists public.textbook_progression_documents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  original_name text not null,
  storage_bucket text not null default 'progressions',
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.textbook_progression_templates (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  document_id uuid references public.textbook_progression_documents(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  institution_subject_id uuid references public.institution_subjects(id) on delete set null,
  subject_name text,
  level text not null,
  series text,
  title text not null,
  description text,
  status text not null default 'active' check (status in ('draft','active','archived')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.textbook_progression_items (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  progression_id uuid not null references public.textbook_progression_templates(id) on delete cascade,
  parent_id uuid references public.textbook_progression_items(id) on delete cascade,
  item_type text not null default 'lesson' check (
    item_type in (
      'section','theme','competency','rubric','chapter','lesson','sequence','session',
      'evaluation','remediation','regulation','revision','other'
    )
  ),
  title text not null,
  description text,
  rubric text,
  theme text,
  competency text,
  trimester text,
  month_label text,
  week_label text,
  planned_duration_minutes integer,
  planned_sessions_count integer,
  sort_order integer not null default 0,
  indent_level integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.textbook_progression_class_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  progression_id uuid not null references public.textbook_progression_templates(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid references public.profiles(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  institution_subject_id uuid references public.institution_subjects(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Colonne générée permettant un upsert propre même quand teacher_id est NULL.
alter table public.textbook_progression_class_assignments
  add column if not exists teacher_id_key uuid
  generated always as (coalesce(teacher_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;

create table if not exists public.textbook_lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  assignment_id uuid not null references public.textbook_progression_class_assignments(id) on delete cascade,
  progression_id uuid not null references public.textbook_progression_templates(id) on delete cascade,
  item_id uuid not null references public.textbook_progression_items(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  institution_subject_id uuid references public.institution_subjects(id) on delete set null,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  session_title text not null default 'Séance 1',
  session_date date not null default current_date,
  duration_minutes integer not null default 55,
  content text,
  homework text,
  observations text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.textbook_lesson_completions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  assignment_id uuid not null references public.textbook_progression_class_assignments(id) on delete cascade,
  progression_id uuid not null references public.textbook_progression_templates(id) on delete cascade,
  item_id uuid not null references public.textbook_progression_items(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  institution_subject_id uuid references public.institution_subjects(id) on delete set null,
  teacher_id uuid references public.profiles(id) on delete set null,
  status text not null default 'in_progress' check (status in ('not_started','in_progress','completed','validated','reopened')),
  completed_at timestamptz,
  completed_by uuid,
  validated_at timestamptz,
  validated_by uuid,
  validation_note text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, item_id)
);

create table if not exists public.textbook_lesson_status_logs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  assignment_id uuid not null references public.textbook_progression_class_assignments(id) on delete cascade,
  progression_id uuid not null references public.textbook_progression_templates(id) on delete cascade,
  item_id uuid not null references public.textbook_progression_items(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid references public.profiles(id) on delete set null,
  status text not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_textbook_documents_institution_year
  on public.textbook_progression_documents (institution_id, academic_year, created_at desc);

create index if not exists idx_textbook_templates_institution_year
  on public.textbook_progression_templates (institution_id, academic_year, status, level, subject_id);

create index if not exists idx_textbook_items_progression_order
  on public.textbook_progression_items (progression_id, sort_order, created_at);

create index if not exists idx_textbook_assignments_institution_class
  on public.textbook_progression_class_assignments (institution_id, class_id, is_active);

create unique index if not exists ux_textbook_assignments_progression_class_teacher
  on public.textbook_progression_class_assignments (progression_id, class_id, teacher_id_key);

create index if not exists idx_textbook_sessions_assignment_item
  on public.textbook_lesson_sessions (assignment_id, item_id, teacher_id, session_date desc);

create index if not exists idx_textbook_sessions_institution_class_subject
  on public.textbook_lesson_sessions (institution_id, class_id, subject_id, session_date desc);

create index if not exists idx_textbook_completions_institution_status
  on public.textbook_lesson_completions (institution_id, status, updated_at desc);

create or replace function public.textbook_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_textbook_templates_updated_at') then
    create trigger trg_textbook_templates_updated_at
    before update on public.textbook_progression_templates
    for each row execute function public.textbook_touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_textbook_items_updated_at') then
    create trigger trg_textbook_items_updated_at
    before update on public.textbook_progression_items
    for each row execute function public.textbook_touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_textbook_assignments_updated_at') then
    create trigger trg_textbook_assignments_updated_at
    before update on public.textbook_progression_class_assignments
    for each row execute function public.textbook_touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_textbook_sessions_updated_at') then
    create trigger trg_textbook_sessions_updated_at
    before update on public.textbook_lesson_sessions
    for each row execute function public.textbook_touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_textbook_completions_updated_at') then
    create trigger trg_textbook_completions_updated_at
    before update on public.textbook_lesson_completions
    for each row execute function public.textbook_touch_updated_at();
  end if;
end $$;

comment on table public.textbook_progression_templates is
  'Progressions pédagogiques officielles structurées par établissement, année, discipline et niveau/classe.';
comment on table public.textbook_progression_items is
  'Arbre souple de progression : rubriques, thèmes, compétences, leçons, séquences, évaluations, remédiations.';
comment on table public.textbook_lesson_sessions is
  'Séances réellement saisies par les enseignants dans le cahier de texte.';
comment on table public.textbook_lesson_completions is
  'Statut d’avancement par leçon/séquence et par classe affectée.';

commit;

-- Contrôle rapide après exécution.
select
  'textbook_module_v1_ok' as check_name,
  count(*) as progressions_existantes
from public.textbook_progression_templates;
