-- =========================================================
-- Mon Cahier — Module Infirmerie V1
-- Objectif : enregistrer les passages à l'infirmerie et produire un reçu justificatif.
-- Important : ce module ne justifie pas automatiquement les absences et ne modifie pas les notes.
-- Le reçu sert de pièce pour l'éducateur et/ou le professeur.
-- =========================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.infirmary_visits (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text,
  student_id uuid not null references public.students(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,

  receipt_code text not null unique,
  visit_date date not null default current_date,
  entry_time time not null,
  exit_time time,
  duration_minutes integer,

  reason_category text not null default 'autre',
  reason_details text,
  condition_description text,
  rest_start_date date,
  rest_end_date date,
  rest_days integer,
  action_taken text,
  status text not null default 'observation'
    check (status in ('observation', 'retour_classe', 'parent_informe', 'evacue', 'cloture')),

  notify_parent_requested boolean not null default false,
  parent_notified boolean not null default false,
  parent_notified_at timestamptz,
  notification_count integer not null default 0,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_infirmary_visits_institution_created
  on public.infirmary_visits(institution_id, created_at desc);

create index if not exists idx_infirmary_visits_student_date
  on public.infirmary_visits(student_id, visit_date desc);

create index if not exists idx_infirmary_visits_class_date
  on public.infirmary_visits(class_id, visit_date desc);

comment on table public.infirmary_visits is
  'Passages à l''infirmerie scolaire. Le reçu généré sert de justificatif, sans modification automatique des absences ou des notes.';

comment on column public.infirmary_visits.reason_category is
  'Motif général uniquement.';

comment on column public.infirmary_visits.condition_description is
  'Ce dont souffre l''enfant ou constat utile saisi sur le billet d''infirmerie.';

comment on column public.infirmary_visits.rest_start_date is
  'Date de début du repos ou congé accordé, si applicable.';

comment on column public.infirmary_visits.rest_end_date is
  'Date de fin du repos ou congé accordé, si applicable.';

comment on column public.infirmary_visits.rest_days is
  'Nombre de jours de repos ou congé calculé inclusivement entre début et fin.';

comment on column public.infirmary_visits.receipt_code is
  'Code du reçu d''infirmerie remis comme pièce justificative interne.';

commit;
