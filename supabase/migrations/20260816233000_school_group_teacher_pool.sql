-- Shared teacher directory for school groups.
--
-- Teacher identities and roles remain independent from academic years.
-- Class assignments remain year-scoped through classes.academic_year + class_id.
-- A school may belong to at most one group; standalone schools need no row here.

create table if not exists public.school_groups (
  id uuid primary key default gen_random_uuid(),
  code text null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_groups_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists school_groups_code_uq
  on public.school_groups (lower(code))
  where code is not null and btrim(code) <> '';

create table if not exists public.school_group_institutions (
  group_id uuid not null references public.school_groups(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, institution_id),
  constraint school_group_institutions_one_group_per_school unique (institution_id)
);

create index if not exists school_group_institutions_group_idx
  on public.school_group_institutions (group_id);

comment on table public.school_groups is
  'Optional grouping of institutions that share one active teacher directory.';
comment on table public.school_group_institutions is
  'Links each institution to at most one school group. Teacher class assignments remain institution/year specific.';

alter table public.school_groups enable row level security;
alter table public.school_group_institutions enable row level security;

-- No authenticated/anon policies on purpose. These tables are infrastructure
-- metadata and are read/written by server-side admin routes using service_role.
-- This prevents clients from discovering or editing another school group.

revoke all on table public.school_groups from anon, authenticated;
revoke all on table public.school_group_institutions from anon, authenticated;

grant all on table public.school_groups to service_role;
grant all on table public.school_group_institutions to service_role;

-- Rehiring / transfer safety.
-- Removing the last teacher role deliberately clears profiles.institution_id.
-- When the same account is later reactivated as a teacher, restore a current
-- institution only if the profile no longer has one. Never overwrite an
-- already-active institution: multi-school context remains an explicit concern.
create or replace function public.ensure_teacher_profile_institution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role::text = 'teacher' and new.institution_id is not null then
    update public.profiles
       set institution_id = new.institution_id
     where id = new.profile_id
       and institution_id is null;
  end if;

  return new;
end;
$$;

drop trigger if exists user_roles_restore_teacher_profile_institution
  on public.user_roles;

create trigger user_roles_restore_teacher_profile_institution
after insert or update of role, institution_id
on public.user_roles
for each row
execute function public.ensure_teacher_profile_institution();

revoke all on function public.ensure_teacher_profile_institution() from public;
grant execute on function public.ensure_teacher_profile_institution() to service_role;
