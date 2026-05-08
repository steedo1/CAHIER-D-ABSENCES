-- =========================================================
-- MODULE : Montage emploi du temps / modèle HoraClasse
-- Projet : Mon Cahier
-- Objet  : Tables + fonctions nécessaires au module Montage EDT
-- Impact : Ne publie rien automatiquement dans teacher_timetables
-- =========================================================

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1. Projets / brouillons de montage
-- =========================================================

create table if not exists public.montage_timetable_projects (
  id uuid primary key default gen_random_uuid(),

  institution_id uuid not null
    references public.institutions(id)
    on delete cascade,

  created_by uuid null
    references auth.users(id)
    on delete set null,

  name text not null default 'Brouillon montage emploi du temps',

  status text not null default 'draft'
    check (status in ('draft', 'ready', 'published', 'archived')),

  academic_year_id uuid null,

  source_snapshot jsonb not null default '{}'::jsonb,
  engine_input jsonb not null default '{}'::jsonb,
  engine_result jsonb not null default '{}'::jsonb,
  diagnostics jsonb not null default '[]'::jsonb,

  published_at timestamptz null,
  archived_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.montage_timetable_projects is
'Brouillons et résultats générés par le module Montage emploi du temps.';

-- =========================================================
-- 2. Sauvegardes avant publication officielle
-- =========================================================

create table if not exists public.montage_timetable_publication_backups (
  id uuid primary key default gen_random_uuid(),

  institution_id uuid not null
    references public.institutions(id)
    on delete cascade,

  project_id uuid null
    references public.montage_timetable_projects(id)
    on delete set null,

  created_by uuid null
    references auth.users(id)
    on delete set null,

  reason text not null default 'publication_montage_emploi_du_temps',

  old_teacher_timetables jsonb not null default '[]'::jsonb,
  new_teacher_timetables jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.montage_timetable_publication_backups is
'Sauvegardes des emplois du temps officiels avant publication depuis le module Montage emploi du temps.';

-- =========================================================
-- 3. Services HoraClasse : volumes / splitPattern
-- =========================================================

create table if not exists public.montage_timetable_subject_hours (
  id uuid primary key default gen_random_uuid(),

  institution_id uuid not null
    references public.institutions(id)
    on delete cascade,

  class_id uuid not null
    references public.classes(id)
    on delete cascade,

  subject_id uuid not null
    references public.institution_subjects(id)
    on delete cascade,

  teacher_id uuid not null
    references public.profiles(id)
    on delete cascade,

  weekly_units numeric(5,2) not null
    check (weekly_units > 0),

  split_pattern text not null,

  room_type_required text null
    check (
      room_type_required is null
      or room_type_required in (
        'ordinary',
        'pc_lab',
        'svt_lab',
        'computer_lab',
        'sports_field'
      )
    ),

  is_active boolean not null default true,

  created_by uuid null
    references public.profiles(id)
    on delete set null,

  updated_by uuid null
    references public.profiles(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint montage_subject_hours_unique
    unique (institution_id, class_id, subject_id, teacher_id)
);

comment on table public.montage_timetable_subject_hours is
'Services HoraClasse : volume horaire hebdomadaire et découpage des blocs.';

comment on column public.montage_timetable_subject_hours.weekly_units is
'Nombre d’unités horaires hebdomadaires à placer.';

comment on column public.montage_timetable_subject_hours.split_pattern is
'Découpage HoraClasse : 1, 2, 1+1, 2+1, 2+2, 2+2+1, etc.';

-- =========================================================
-- 4. Règles terrain HoraClasse
-- =========================================================

create table if not exists public.montage_timetable_terrain_rules (
  id uuid primary key default gen_random_uuid(),

  institution_id uuid not null
    references public.institutions(id)
    on delete cascade,

  rules jsonb not null default '{}'::jsonb,

  created_by uuid null
    references public.profiles(id)
    on delete set null,

  updated_by uuid null
    references public.profiles(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint montage_terrain_rules_unique
    unique (institution_id)
);

comment on table public.montage_timetable_terrain_rules is
'Configuration des règles terrain HoraClasse par établissement.';

comment on column public.montage_timetable_terrain_rules.rules is
'JSON des règles terrain : tandem PC/SVT, EPS, trous profs/élèves, matières lourdes, demi-journées, salles, etc.';

-- =========================================================
-- 5. Indisponibilités enseignants pour le moteur HoraClasse
-- =========================================================

create table if not exists public.montage_timetable_teacher_unavailability (
  id uuid primary key default gen_random_uuid(),

  institution_id uuid not null
    references public.institutions(id)
    on delete cascade,

  teacher_id uuid not null
    references public.profiles(id)
    on delete cascade,

  weekday int not null check (weekday between 1 and 7),

  period_id uuid null
    references public.institution_periods(id)
    on delete cascade,

  period_no int null,

  half_day text null
    check (half_day is null or half_day in ('morning', 'afternoon', 'evening')),

  constraint_type text not null default 'strict'
    check (constraint_type in ('strict', 'preference')),

  reason text null,

  is_active boolean not null default true,

  created_by uuid null
    references public.profiles(id)
    on delete set null,

  updated_by uuid null
    references public.profiles(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.montage_timetable_teacher_unavailability is
'Indisponibilités strictes ou préférences des enseignants pour le moteur HoraClasse.';

-- =========================================================
-- 6. Salles et ressources HoraClasse
-- =========================================================

create table if not exists public.montage_timetable_resources (
  id uuid primary key default gen_random_uuid(),

  institution_id uuid not null
    references public.institutions(id)
    on delete cascade,

  name text not null,

  resource_type text not null
    check (
      resource_type in (
        'ordinary',
        'pc_lab',
        'svt_lab',
        'computer_lab',
        'sports_field'
      )
    ),

  capacity int null check (capacity is null or capacity > 0),

  is_shared boolean not null default true,
  is_active boolean not null default true,

  metadata jsonb not null default '{}'::jsonb,

  created_by uuid null
    references public.profiles(id)
    on delete set null,

  updated_by uuid null
    references public.profiles(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.montage_timetable_resources is
'Salles, laboratoires, terrain EPS et ressources nécessaires au moteur HoraClasse.';

-- =========================================================
-- 7. Préférences salle principale par classe
-- =========================================================

create table if not exists public.montage_timetable_class_room_preferences (
  id uuid primary key default gen_random_uuid(),

  institution_id uuid not null
    references public.institutions(id)
    on delete cascade,

  class_id uuid not null
    references public.classes(id)
    on delete cascade,

  resource_id uuid not null
    references public.montage_timetable_resources(id)
    on delete cascade,

  priority int not null default 1,
  usage_type text not null default 'main'
    check (usage_type in ('main', 'allowed', 'forbidden')),

  is_allowed boolean not null default true,

  created_by uuid null
    references public.profiles(id)
    on delete set null,

  updated_by uuid null
    references public.profiles(id)
    on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint montage_class_room_pref_unique
    unique (institution_id, class_id, resource_id)
);

comment on table public.montage_timetable_class_room_preferences is
'Préférences de salles par classe pour le moteur HoraClasse.';

-- =========================================================
-- 8. Index
-- =========================================================

create index if not exists idx_montage_projects_institution
  on public.montage_timetable_projects(institution_id);

create index if not exists idx_montage_projects_status
  on public.montage_timetable_projects(status);

create index if not exists idx_montage_projects_created_at
  on public.montage_timetable_projects(created_at desc);

create index if not exists idx_montage_projects_institution_status
  on public.montage_timetable_projects(institution_id, status);

create index if not exists idx_montage_backups_institution
  on public.montage_timetable_publication_backups(institution_id);

create index if not exists idx_montage_backups_project
  on public.montage_timetable_publication_backups(project_id);

create index if not exists idx_montage_subject_hours_institution
  on public.montage_timetable_subject_hours(institution_id);

create index if not exists idx_montage_subject_hours_class
  on public.montage_timetable_subject_hours(class_id);

create index if not exists idx_montage_subject_hours_teacher
  on public.montage_timetable_subject_hours(teacher_id);

create index if not exists idx_montage_terrain_rules_institution
  on public.montage_timetable_terrain_rules(institution_id);

create index if not exists idx_montage_teacher_unavailability_institution
  on public.montage_timetable_teacher_unavailability(institution_id);

create index if not exists idx_montage_teacher_unavailability_teacher
  on public.montage_timetable_teacher_unavailability(teacher_id);

create index if not exists idx_montage_resources_institution
  on public.montage_timetable_resources(institution_id);

create index if not exists idx_montage_resources_type
  on public.montage_timetable_resources(resource_type);

create index if not exists idx_montage_room_pref_institution
  on public.montage_timetable_class_room_preferences(institution_id);

create index if not exists idx_montage_room_pref_class
  on public.montage_timetable_class_room_preferences(class_id);

-- =========================================================
-- 9. Fonction updated_at générique
-- =========================================================

create or replace function public.montage_set_updated_at()
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
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_montage_timetable_projects_updated_at'
  ) then
    create trigger trg_montage_timetable_projects_updated_at
    before update on public.montage_timetable_projects
    for each row execute function public.montage_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_montage_subject_hours_updated_at'
  ) then
    create trigger trg_montage_subject_hours_updated_at
    before update on public.montage_timetable_subject_hours
    for each row execute function public.montage_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_montage_terrain_rules_updated_at'
  ) then
    create trigger trg_montage_terrain_rules_updated_at
    before update on public.montage_timetable_terrain_rules
    for each row execute function public.montage_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_montage_teacher_unavailability_updated_at'
  ) then
    create trigger trg_montage_teacher_unavailability_updated_at
    before update on public.montage_timetable_teacher_unavailability
    for each row execute function public.montage_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_montage_resources_updated_at'
  ) then
    create trigger trg_montage_resources_updated_at
    before update on public.montage_timetable_resources
    for each row execute function public.montage_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_montage_class_room_preferences_updated_at'
  ) then
    create trigger trg_montage_class_room_preferences_updated_at
    before update on public.montage_timetable_class_room_preferences
    for each row execute function public.montage_set_updated_at();
  end if;
end $$;

-- =========================================================
-- 10. RLS
-- =========================================================

alter table public.montage_timetable_projects enable row level security;
alter table public.montage_timetable_publication_backups enable row level security;
alter table public.montage_timetable_subject_hours enable row level security;
alter table public.montage_timetable_terrain_rules enable row level security;
alter table public.montage_timetable_teacher_unavailability enable row level security;
alter table public.montage_timetable_resources enable row level security;
alter table public.montage_timetable_class_room_preferences enable row level security;

-- =========================================================
-- 11. Nettoyage policies
-- =========================================================

drop policy if exists "montage_projects_select_admin" on public.montage_timetable_projects;
drop policy if exists "montage_projects_insert_admin" on public.montage_timetable_projects;
drop policy if exists "montage_projects_update_admin" on public.montage_timetable_projects;
drop policy if exists "montage_projects_delete_admin" on public.montage_timetable_projects;

drop policy if exists "montage_backups_select_admin" on public.montage_timetable_publication_backups;
drop policy if exists "montage_backups_insert_admin" on public.montage_timetable_publication_backups;
drop policy if exists "montage_backups_update_admin" on public.montage_timetable_publication_backups;
drop policy if exists "montage_backups_delete_admin" on public.montage_timetable_publication_backups;

drop policy if exists "montage_subject_hours_select_admin" on public.montage_timetable_subject_hours;
drop policy if exists "montage_subject_hours_insert_admin" on public.montage_timetable_subject_hours;
drop policy if exists "montage_subject_hours_update_admin" on public.montage_timetable_subject_hours;
drop policy if exists "montage_subject_hours_delete_admin" on public.montage_timetable_subject_hours;

drop policy if exists "montage_terrain_rules_select_admin" on public.montage_timetable_terrain_rules;
drop policy if exists "montage_terrain_rules_insert_admin" on public.montage_timetable_terrain_rules;
drop policy if exists "montage_terrain_rules_update_admin" on public.montage_timetable_terrain_rules;
drop policy if exists "montage_terrain_rules_delete_admin" on public.montage_timetable_terrain_rules;

drop policy if exists "montage_teacher_unavailability_select_admin" on public.montage_timetable_teacher_unavailability;
drop policy if exists "montage_teacher_unavailability_insert_admin" on public.montage_timetable_teacher_unavailability;
drop policy if exists "montage_teacher_unavailability_update_admin" on public.montage_timetable_teacher_unavailability;
drop policy if exists "montage_teacher_unavailability_delete_admin" on public.montage_timetable_teacher_unavailability;

drop policy if exists "montage_resources_select_admin" on public.montage_timetable_resources;
drop policy if exists "montage_resources_insert_admin" on public.montage_timetable_resources;
drop policy if exists "montage_resources_update_admin" on public.montage_timetable_resources;
drop policy if exists "montage_resources_delete_admin" on public.montage_timetable_resources;

drop policy if exists "montage_room_pref_select_admin" on public.montage_timetable_class_room_preferences;
drop policy if exists "montage_room_pref_insert_admin" on public.montage_timetable_class_room_preferences;
drop policy if exists "montage_room_pref_update_admin" on public.montage_timetable_class_room_preferences;
drop policy if exists "montage_room_pref_delete_admin" on public.montage_timetable_class_room_preferences;

-- =========================================================
-- 12. Policies helper pattern : admin / super_admin
-- =========================================================

create policy "montage_projects_select_admin"
on public.montage_timetable_projects
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_projects.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_projects_insert_admin"
on public.montage_timetable_projects
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_projects.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_projects_update_admin"
on public.montage_timetable_projects
for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_projects.institution_id
      and ur.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_projects.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_projects_delete_admin"
on public.montage_timetable_projects
for delete to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_projects.institution_id
      and ur.role = 'super_admin'
  )
);

create policy "montage_backups_select_admin"
on public.montage_timetable_publication_backups
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_publication_backups.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_backups_insert_admin"
on public.montage_timetable_publication_backups
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_publication_backups.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_backups_update_admin"
on public.montage_timetable_publication_backups
for update to authenticated
using (false)
with check (false);

create policy "montage_backups_delete_admin"
on public.montage_timetable_publication_backups
for delete to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_publication_backups.institution_id
      and ur.role = 'super_admin'
  )
);

create policy "montage_subject_hours_select_admin"
on public.montage_timetable_subject_hours
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_subject_hours.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_subject_hours_insert_admin"
on public.montage_timetable_subject_hours
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_subject_hours.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_subject_hours_update_admin"
on public.montage_timetable_subject_hours
for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_subject_hours.institution_id
      and ur.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_subject_hours.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_subject_hours_delete_admin"
on public.montage_timetable_subject_hours
for delete to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_subject_hours.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_terrain_rules_select_admin"
on public.montage_timetable_terrain_rules
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_terrain_rules.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_terrain_rules_insert_admin"
on public.montage_timetable_terrain_rules
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_terrain_rules.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_terrain_rules_update_admin"
on public.montage_timetable_terrain_rules
for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_terrain_rules.institution_id
      and ur.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_terrain_rules.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_terrain_rules_delete_admin"
on public.montage_timetable_terrain_rules
for delete to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_terrain_rules.institution_id
      and ur.role = 'super_admin'
  )
);

create policy "montage_teacher_unavailability_select_admin"
on public.montage_timetable_teacher_unavailability
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_teacher_unavailability.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_teacher_unavailability_insert_admin"
on public.montage_timetable_teacher_unavailability
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_teacher_unavailability.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_teacher_unavailability_update_admin"
on public.montage_timetable_teacher_unavailability
for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_teacher_unavailability.institution_id
      and ur.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_teacher_unavailability.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_teacher_unavailability_delete_admin"
on public.montage_timetable_teacher_unavailability
for delete to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_teacher_unavailability.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_resources_select_admin"
on public.montage_timetable_resources
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_resources.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_resources_insert_admin"
on public.montage_timetable_resources
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_resources.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_resources_update_admin"
on public.montage_timetable_resources
for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_resources.institution_id
      and ur.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_resources.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_resources_delete_admin"
on public.montage_timetable_resources
for delete to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_resources.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_room_pref_select_admin"
on public.montage_timetable_class_room_preferences
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_class_room_preferences.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_room_pref_insert_admin"
on public.montage_timetable_class_room_preferences
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_class_room_preferences.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_room_pref_update_admin"
on public.montage_timetable_class_room_preferences
for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_class_room_preferences.institution_id
      and ur.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_class_room_preferences.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

create policy "montage_room_pref_delete_admin"
on public.montage_timetable_class_room_preferences
for delete to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = montage_timetable_class_room_preferences.institution_id
      and ur.role in ('admin', 'super_admin')
  )
);

-- =========================================================
-- 13. Fonction publication officielle
-- Ne publie rien seule : elle attend un appel API explicite
-- =========================================================

create or replace function public.montage_publish_timetable(
  p_project_id uuid,
  p_institution_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.montage_timetable_projects%rowtype;
  v_assignments jsonb;
  v_old_rows jsonb;
  v_new_rows jsonb;
  v_backup_id uuid;
  v_missing_count int := 0;
  v_teacher_conflicts int := 0;
  v_class_conflicts int := 0;
  v_inserted_count int := 0;
begin
  select *
  into v_project
  from public.montage_timetable_projects
  where id = p_project_id
    and institution_id = p_institution_id
  for update;

  if not found then
    raise exception 'Brouillon introuvable pour cet établissement.';
  end if;

  if v_project.status = 'published' then
    raise exception 'Ce brouillon est déjà publié.';
  end if;

  v_assignments := coalesce(v_project.engine_result -> 'assignments', '[]'::jsonb);

  if jsonb_typeof(v_assignments) <> 'array' or jsonb_array_length(v_assignments) = 0 then
    raise exception 'Aucun cours généré à publier.';
  end if;

  select count(*)
  into v_missing_count
  from jsonb_array_elements(v_assignments) as a(x)
  where nullif(a.x ->> 'class_id', '') is null
     or nullif(a.x ->> 'subject_id', '') is null
     or nullif(a.x ->> 'teacher_id', '') is null
     or nullif(a.x ->> 'period_id', '') is null
     or not (
       (a.x ->> 'weekday') ~ '^[0-9]+$'
       and (a.x ->> 'weekday')::int between 1 and 7
     );

  if v_missing_count > 0 then
    raise exception 'Publication impossible : % cours ont des données incomplètes.', v_missing_count;
  end if;

  select count(*)
  into v_teacher_conflicts
  from (
    select
      a.x ->> 'teacher_id' as teacher_id,
      a.x ->> 'period_id' as period_id,
      count(*) as total
    from jsonb_array_elements(v_assignments) as a(x)
    group by a.x ->> 'teacher_id', a.x ->> 'period_id'
    having count(*) > 1
  ) q;

  if v_teacher_conflicts > 0 then
    raise exception 'Publication impossible : conflit professeur détecté.';
  end if;

  select count(*)
  into v_class_conflicts
  from (
    select
      a.x ->> 'class_id' as class_id,
      a.x ->> 'period_id' as period_id,
      count(*) as total
    from jsonb_array_elements(v_assignments) as a(x)
    group by a.x ->> 'class_id', a.x ->> 'period_id'
    having count(*) > 1
  ) q;

  if v_class_conflicts > 0 then
    raise exception 'Publication impossible : conflit classe détecté.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.weekday, t.period_id, t.created_at), '[]'::jsonb)
  into v_old_rows
  from public.teacher_timetables t
  where t.institution_id = p_institution_id;

  delete from public.teacher_timetables
  where institution_id = p_institution_id;

  with inserted as (
    insert into public.teacher_timetables (
      institution_id,
      class_id,
      subject_id,
      teacher_id,
      weekday,
      period_id,
      created_by,
      updated_by,
      created_at,
      updated_at
    )
    select
      p_institution_id,
      (a.x ->> 'class_id')::uuid,
      (a.x ->> 'subject_id')::uuid,
      (a.x ->> 'teacher_id')::uuid,
      (a.x ->> 'weekday')::int,
      (a.x ->> 'period_id')::uuid,
      p_user_id,
      p_user_id,
      now(),
      now()
    from jsonb_array_elements(v_assignments) as a(x)
    returning *
  )
  select
    count(*),
    coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.weekday, inserted.period_id, inserted.created_at), '[]'::jsonb)
  into v_inserted_count, v_new_rows
  from inserted;

  insert into public.montage_timetable_publication_backups (
    institution_id,
    project_id,
    created_by,
    reason,
    old_teacher_timetables,
    new_teacher_timetables
  )
  values (
    p_institution_id,
    p_project_id,
    p_user_id,
    'publication_montage_emploi_du_temps',
    v_old_rows,
    v_new_rows
  )
  returning id into v_backup_id;

  update public.montage_timetable_projects
  set
    status = 'archived',
    archived_at = now()
  where institution_id = p_institution_id
    and id <> p_project_id
    and status = 'published';

  update public.montage_timetable_projects
  set
    status = 'published',
    published_at = now(),
    updated_at = now()
  where id = p_project_id
    and institution_id = p_institution_id;

  return jsonb_build_object(
    'ok', true,
    'project_id', p_project_id,
    'institution_id', p_institution_id,
    'backup_id', v_backup_id,
    'inserted_count', v_inserted_count,
    'message', 'Emploi du temps publié officiellement.'
  );
end;
$$;

-- =========================================================
-- 14. Vérification finale
-- =========================================================

select
  'montage_timetable_projects' as table_name,
  count(*) as total
from public.montage_timetable_projects

union all

select
  'montage_timetable_publication_backups' as table_name,
  count(*) as total
from public.montage_timetable_publication_backups

union all

select
  'montage_timetable_subject_hours' as table_name,
  count(*) as total
from public.montage_timetable_subject_hours

union all

select
  'montage_timetable_terrain_rules' as table_name,
  count(*) as total
from public.montage_timetable_terrain_rules

union all

select
  'montage_timetable_teacher_unavailability' as table_name,
  count(*) as total
from public.montage_timetable_teacher_unavailability

union all

select
  'montage_timetable_resources' as table_name,
  count(*) as total
from public.montage_timetable_resources

union all

select
  'montage_timetable_class_room_preferences' as table_name,
  count(*) as total
from public.montage_timetable_class_room_preferences;

commit;
