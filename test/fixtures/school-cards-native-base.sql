-- Ephemeral local Supabase fixture ONLY. Never a production migration.
-- Fail before any change if an application schema is already present.
do $$ begin
  if to_regclass('public.institutions') is not null then raise exception 'fixture_requires_empty_local_database'; end if;
end $$;
create table public.institutions (
  id uuid primary key,name text not null,code text,phone text,logo_url text,head_name text,head_title text,
  country_name text,country_motto text,ministry_name text,settings_json jsonb not null default '{}',subscription_expires_at date
);
create table public.profiles(id uuid primary key references auth.users(id),institution_id uuid references public.institutions(id));
create table public.user_roles(id uuid primary key default gen_random_uuid(),profile_id uuid references public.profiles(id),institution_id uuid references public.institutions(id),role text not null);
create table public.academic_years(id uuid primary key default gen_random_uuid(),institution_id uuid references public.institutions(id),code text,start_date date,end_date date,is_current boolean,unique(institution_id,code));
create table public.classes(id uuid primary key,institution_id uuid references public.institutions(id),label text,level text,academic_year text,education_type text);
create table public.students(id uuid primary key,institution_id uuid references public.institutions(id),full_name text,full_name_ar text,first_name text,last_name text,matricule text,birthdate date,birth_place text,gender text,photo_path text,lifecycle_status text);
create table public.class_enrollments(id uuid primary key,institution_id uuid references public.institutions(id),student_id uuid references public.students(id),class_id uuid references public.classes(id),start_date date,end_date date);
create table public.educator_class_assignments(id uuid primary key default gen_random_uuid(),institution_id uuid references public.institutions(id),profile_id uuid references public.profiles(id),class_id uuid references public.classes(id),level text);
do $$ declare t text; begin
  foreach t in array array['institutions','profiles','user_roles','academic_years','classes','students','class_enrollments','educator_class_assignments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
  end loop;
end $$;
grant select on public.profiles to authenticated;
create policy own_profile on public.profiles for select to authenticated using ((select auth.uid())=id);
create function public.fn_upsert_role(uuid,uuid,text) returns void language sql as 'select';
grant execute on function public.fn_upsert_role(uuid,uuid,text) to service_role;
grant select on public.user_roles to authenticated;
create policy own_roles on public.user_roles for select to authenticated using ((select auth.uid())=profile_id);
notify pgrst,'reload schema';
