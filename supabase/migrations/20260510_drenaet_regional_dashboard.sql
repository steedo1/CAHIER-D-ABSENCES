-- 20260510_drenaet_regional_dashboard.sql
-- Mon Cahier — Interface régionale DRENAET
-- Objectif : rattacher un compte DRENAET à une ou plusieurs directions régionales
-- sans modifier la logique admin établissement ni la logique super-admin.

begin;

create extension if not exists pgcrypto;

-- 0) Si user_roles.role est basé sur un type ENUM, on ajoute la valeur drenaet_admin.
-- Si role est un simple text/varchar, ce bloc ne change rien.
do $$
declare
  enum_schema text;
  enum_name text;
begin
  select ns.nspname, t.typname
    into enum_schema, enum_name
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_type t on t.oid = a.atttypid
  join pg_namespace ns on ns.oid = t.typnamespace
  where c.relname = 'user_roles'
    and a.attname = 'role'
    and t.typtype = 'e'
  limit 1;

  if enum_name is not null then
    execute format('alter type %I.%I add value if not exists %L', enum_schema, enum_name, 'drenaet_admin');
  end if;
end $$;

-- 1) Table de périmètre DRENAET
-- Chaque ligne signifie : ce profil peut superviser les établissements dont
-- institutions.regional_direction correspond à regional_direction.
create table if not exists public.drenaet_user_scopes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  regional_direction text not null,
  can_export boolean not null default true,
  can_view_grades boolean not null default true,
  can_view_teacher_presence boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(id) on delete set null,
  constraint drenaet_user_scopes_direction_not_empty check (length(trim(regional_direction)) > 0),
  constraint drenaet_user_scopes_unique unique (profile_id, regional_direction)
);

create index if not exists drenaet_user_scopes_profile_idx
  on public.drenaet_user_scopes(profile_id);

create index if not exists drenaet_user_scopes_direction_idx
  on public.drenaet_user_scopes(regional_direction);

-- 2) Index utile pour retrouver rapidement les établissements d'une DRENAET.
create index if not exists institutions_regional_direction_idx
  on public.institutions(regional_direction);

-- 3) RLS : on active une sécurité simple.
alter table public.drenaet_user_scopes enable row level security;

-- Les super_admin peuvent gérer les périmètres DRENAET.
drop policy if exists "super_admin_manage_drenaet_user_scopes" on public.drenaet_user_scopes;
create policy "super_admin_manage_drenaet_user_scopes"
on public.drenaet_user_scopes
for all
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.role = 'super_admin'
  )
);

-- Un utilisateur DRENAET peut lire son propre périmètre.
drop policy if exists "drenaet_read_own_scopes" on public.drenaet_user_scopes;
create policy "drenaet_read_own_scopes"
on public.drenaet_user_scopes
for select
using (profile_id = auth.uid());

commit;

-- Exemple à adapter après création du compte DRENAET :
-- 1) Vérifier que le profil a bien le rôle drenaet_admin :
-- insert into public.user_roles(profile_id, role, institution_id)
-- values ('PROFILE_UUID_ICI', 'drenaet_admin', null)
-- on conflict do nothing;
--
-- 2) Rattacher ce compte à une direction régionale :
-- insert into public.drenaet_user_scopes(profile_id, regional_direction, can_export, can_view_grades, can_view_teacher_presence)
-- values ('PROFILE_UUID_ICI', 'DRENAET ABOISSO', true, true, true)
-- on conflict (profile_id, regional_direction) do update set
--   can_export = excluded.can_export,
--   can_view_grades = excluded.can_view_grades,
--   can_view_teacher_presence = excluded.can_view_teacher_presence;
