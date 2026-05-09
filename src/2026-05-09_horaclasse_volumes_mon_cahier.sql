-- Mon Cahier x HoraClasse — volumes horaires personnalisés par service
-- À exécuter une seule fois si la table n'existe pas encore ou si la contrainte unique manque.

create extension if not exists pgcrypto;

create table if not exists public.montage_timetable_subject_hours (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.institution_subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  weekly_units numeric(5,2) not null check (weekly_units > 0),
  split_pattern text not null,
  room_type_required text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists montage_subject_hours_service_uidx
  on public.montage_timetable_subject_hours (institution_id, class_id, subject_id, teacher_id);

create or replace function public.set_montage_subject_hours_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_montage_subject_hours_updated_at on public.montage_timetable_subject_hours;
create trigger trg_montage_subject_hours_updated_at
before update on public.montage_timetable_subject_hours
for each row execute function public.set_montage_subject_hours_updated_at();

alter table public.montage_timetable_subject_hours enable row level security;

-- Les routes admin utilisent le service role. Cette politique garde une lecture possible
-- pour les utilisateurs authentifiés de la même institution si RLS est appliquée côté client.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'montage_timetable_subject_hours'
      and policyname = 'montage subject hours same institution read'
  ) then
    create policy "montage subject hours same institution read"
      on public.montage_timetable_subject_hours
      for select
      to authenticated
      using (
        institution_id in (
          select p.institution_id
          from public.profiles p
          where p.id = auth.uid()
        )
      );
  end if;
end $$;
