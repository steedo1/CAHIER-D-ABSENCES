-- =========================================================
-- MODULE : Montage emploi du temps / HoraClasse dans Mon Cahier
-- Objet  : Tables complémentaires + publication sécurisée
-- Notes  : Script idempotent. À exécuter dans Supabase SQL Editor.
-- =========================================================

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1. Brouillons et sauvegardes publication
-- =========================================================

create table if not exists public.montage_timetable_projects (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  created_by uuid null references auth.users(id) on delete set null,
  name text not null default 'Brouillon montage emploi du temps',
  status text not null default 'draft' check (status in ('draft', 'ready', 'published', 'archived')),
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

create table if not exists public.montage_timetable_publication_backups (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  project_id uuid null references public.montage_timetable_projects(id) on delete set null,
  created_by uuid null references auth.users(id) on delete set null,
  reason text not null default 'publication_montage_emploi_du_temps',
  old_teacher_timetables jsonb not null default '[]'::jsonb,
  new_teacher_timetables jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- =========================================================
-- 2. Overrides des services HoraClasse
-- Les volumes par défaut restent dans le catalogue HoraClasse.
-- Cette table ne stocke que les adaptations de l'établissement.
-- =========================================================

create table if not exists public.montage_timetable_subject_hours (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.institution_subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  weekly_units numeric(5,2) not null check (weekly_units > 0),
  split_pattern text not null,
  is_active boolean not null default true,
  created_by uuid null references public.profiles(id) on delete set null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint montage_subject_hours_unique unique (institution_id, class_id, subject_id, teacher_id)
);

-- =========================================================
-- 3. Règles terrain HoraClasse
-- =========================================================

create table if not exists public.montage_timetable_terrain_rules (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id) on delete set null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint montage_terrain_rules_unique unique (institution_id)
);

-- =========================================================
-- 4. Ressources / salles HoraClasse
-- =========================================================

create table if not exists public.montage_timetable_resources (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null,
  room_type text not null check (room_type in ('ordinary','pc_lab','svt_lab','computer_lab','sports_field','multipurpose','administrative')),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id) on delete set null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 5. Indisponibilités enseignants HoraClasse
-- =========================================================

create table if not exists public.montage_timetable_teacher_unavailability (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),
  period_no int null,
  half_day text null check (half_day in ('morning','afternoon','evening')),
  constraint_type text not null default 'strict' check (constraint_type in ('strict','preference')),
  reason text null,
  is_active boolean not null default true,
  created_by uuid null references public.profiles(id) on delete set null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 6. Index
-- =========================================================

create index if not exists idx_montage_projects_institution_status on public.montage_timetable_projects(institution_id, status);
create index if not exists idx_montage_projects_created_at on public.montage_timetable_projects(created_at desc);
create index if not exists idx_montage_backups_institution on public.montage_timetable_publication_backups(institution_id);
create index if not exists idx_montage_subject_hours_institution on public.montage_timetable_subject_hours(institution_id);
create index if not exists idx_montage_subject_hours_class on public.montage_timetable_subject_hours(class_id);
create index if not exists idx_montage_subject_hours_teacher on public.montage_timetable_subject_hours(teacher_id);
create index if not exists idx_montage_resources_institution on public.montage_timetable_resources(institution_id);
create index if not exists idx_montage_unavailability_institution on public.montage_timetable_teacher_unavailability(institution_id);
create index if not exists idx_montage_unavailability_teacher on public.montage_timetable_teacher_unavailability(teacher_id);

-- =========================================================
-- 7. updated_at générique
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
  if not exists (select 1 from pg_trigger where tgname = 'trg_montage_timetable_projects_updated_at') then
    create trigger trg_montage_timetable_projects_updated_at before update on public.montage_timetable_projects for each row execute function public.montage_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_montage_subject_hours_updated_at') then
    create trigger trg_montage_subject_hours_updated_at before update on public.montage_timetable_subject_hours for each row execute function public.montage_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_montage_terrain_rules_updated_at') then
    create trigger trg_montage_terrain_rules_updated_at before update on public.montage_timetable_terrain_rules for each row execute function public.montage_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_montage_resources_updated_at') then
    create trigger trg_montage_resources_updated_at before update on public.montage_timetable_resources for each row execute function public.montage_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_montage_unavailability_updated_at') then
    create trigger trg_montage_unavailability_updated_at before update on public.montage_timetable_teacher_unavailability for each row execute function public.montage_set_updated_at();
  end if;
end $$;

-- =========================================================
-- 8. RLS minimal admin/super_admin
-- =========================================================

alter table public.montage_timetable_projects enable row level security;
alter table public.montage_timetable_publication_backups enable row level security;
alter table public.montage_timetable_subject_hours enable row level security;
alter table public.montage_timetable_terrain_rules enable row level security;
alter table public.montage_timetable_resources enable row level security;
alter table public.montage_timetable_teacher_unavailability enable row level security;

-- La logique serveur utilise le service role. Les policies protègent l'accès direct client.
-- Pour éviter les collisions, on garde des noms simples et idempotents.
do $$
declare
  tbl text;
  pol text;
begin
  foreach tbl in array array[
    'montage_timetable_projects',
    'montage_timetable_publication_backups',
    'montage_timetable_subject_hours',
    'montage_timetable_terrain_rules',
    'montage_timetable_resources',
    'montage_timetable_teacher_unavailability'
  ] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_admin_all', tbl);
    execute format($fmt$
      create policy %I on public.%I
      for all
      to authenticated
      using (
        exists (
          select 1 from public.user_roles ur
          where ur.profile_id = auth.uid()
            and ur.institution_id = %I.institution_id
            and ur.role in ('admin','super_admin')
        )
      )
      with check (
        exists (
          select 1 from public.user_roles ur
          where ur.profile_id = auth.uid()
            and ur.institution_id = %I.institution_id
            and ur.role in ('admin','super_admin')
        )
      )
    $fmt$, tbl || '_admin_all', tbl, tbl, tbl);
  end loop;
end $$;

-- =========================================================
-- 9. Publication sécurisée vers teacher_timetables
-- À n'appeler qu'après validation du vrai moteur.
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
  select * into v_project
  from public.montage_timetable_projects
  where id = p_project_id and institution_id = p_institution_id
  for update;

  if not found then
    raise exception 'Brouillon introuvable pour cet établissement.';
  end if;

  if v_project.status = 'published' then
    raise exception 'Ce brouillon est déjà publié.';
  end if;

  if coalesce(v_project.engine_result ->> 'status', '') <> 'generated_real_scheduler' then
    raise exception 'Publication impossible : le vrai moteur HoraClasse n’a pas encore généré ce brouillon.';
  end if;

  v_assignments := coalesce(v_project.engine_result -> 'assignments', '[]'::jsonb);

  if jsonb_typeof(v_assignments) <> 'array' or jsonb_array_length(v_assignments) = 0 then
    raise exception 'Aucun cours généré à publier.';
  end if;

  select count(*) into v_missing_count
  from jsonb_array_elements(v_assignments) as a(x)
  where nullif(a.x ->> 'class_id', '') is null
     or nullif(a.x ->> 'subject_id', '') is null
     or nullif(a.x ->> 'teacher_id', '') is null
     or nullif(a.x ->> 'period_id', '') is null
     or not ((a.x ->> 'weekday') ~ '^[0-9]+$' and (a.x ->> 'weekday')::int between 1 and 7);

  if v_missing_count > 0 then
    raise exception 'Publication impossible : % ligne(s) ont des données incomplètes.', v_missing_count;
  end if;

  select count(*) into v_teacher_conflicts
  from (
    select a.x ->> 'teacher_id' as teacher_id, a.x ->> 'period_id' as period_id, count(*) as total
    from jsonb_array_elements(v_assignments) as a(x)
    group by a.x ->> 'teacher_id', a.x ->> 'period_id'
    having count(*) > 1
  ) q;

  if v_teacher_conflicts > 0 then
    raise exception 'Publication impossible : conflit professeur détecté.';
  end if;

  select count(*) into v_class_conflicts
  from (
    select a.x ->> 'class_id' as class_id, a.x ->> 'period_id' as period_id, count(*) as total
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

  delete from public.teacher_timetables where institution_id = p_institution_id;

  with inserted as (
    insert into public.teacher_timetables (
      institution_id, class_id, subject_id, teacher_id, weekday, period_id,
      created_by, updated_by, created_at, updated_at
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
  select count(*), coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.weekday, inserted.period_id, inserted.created_at), '[]'::jsonb)
  into v_inserted_count, v_new_rows
  from inserted;

  insert into public.montage_timetable_publication_backups (
    institution_id, project_id, created_by, reason, old_teacher_timetables, new_teacher_timetables
  ) values (
    p_institution_id, p_project_id, p_user_id, 'publication_montage_emploi_du_temps', v_old_rows, v_new_rows
  ) returning id into v_backup_id;

  update public.montage_timetable_projects
  set status = 'archived', archived_at = now()
  where institution_id = p_institution_id and id <> p_project_id and status = 'published';

  update public.montage_timetable_projects
  set status = 'published', published_at = now(), updated_at = now()
  where id = p_project_id and institution_id = p_institution_id;

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

select 'montage_timetable_projects' as table_name, count(*) as total from public.montage_timetable_projects
union all select 'montage_timetable_subject_hours', count(*) from public.montage_timetable_subject_hours
union all select 'montage_timetable_terrain_rules', count(*) from public.montage_timetable_terrain_rules
union all select 'montage_timetable_resources', count(*) from public.montage_timetable_resources
union all select 'montage_timetable_teacher_unavailability', count(*) from public.montage_timetable_teacher_unavailability;

commit;
