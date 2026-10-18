-- Préscolaire : référentiels et observations qualitatives.
-- Tables isolées des notes numériques et des établissements classiques.
create table if not exists public.preschool_competency_catalogs (
  institution_id uuid not null references public.institutions(id) on delete restrict,
  teaching_track text not null check (teaching_track in ('french','arabic')),
  competencies jsonb not null default '[]'::jsonb check (jsonb_typeof(competencies) = 'array'),
  revision bigint not null default 1 check (revision >= 1),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (institution_id, teaching_track)
);
create table if not exists public.preschool_booklet_records (
  institution_id uuid not null references public.institutions(id) on delete restrict,
  academic_year text not null check (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
  class_id uuid not null,
  period_id uuid not null,
  teaching_track text not null check (teaching_track in ('french','arabic')),
  student_id uuid not null,
  observations jsonb not null default '{}'::jsonb check (jsonb_typeof(observations) = 'object'),
  teacher_comment text not null default '' check (char_length(teacher_comment) <= 1000),
  revision bigint not null default 1 check (revision >= 1),
  edited_by uuid,
  edited_at timestamptz not null default now(),
  primary key (institution_id, academic_year, class_id, period_id, teaching_track, student_id)
);
create index if not exists preschool_booklet_records_student_lookup
  on public.preschool_booklet_records(institution_id, student_id, academic_year);
alter table public.preschool_competency_catalogs enable row level security;
alter table public.preschool_booklet_records enable row level security;
revoke all on table public.preschool_competency_catalogs from public, anon, authenticated;
revoke all on table public.preschool_booklet_records from public, anon, authenticated;
grant select, insert, update on table public.preschool_competency_catalogs to service_role;
grant select, insert, update on table public.preschool_booklet_records to service_role;
comment on table public.preschool_competency_catalogs is 'Approved qualitative preschool skills by institution and French/Arabic teaching track; no numeric grades.';
comment on table public.preschool_booklet_records is 'Qualitative preschool assessments, scoped by institution/year/class/period/track/student; server-authorized access only.';
