-- Verrouillage géographique des appels enseignants — multi-établissements / multi-sites.
-- Désactivé par défaut : aucune école existante n'est bloquée avant son paramétrage.

create extension if not exists pgcrypto;

create table if not exists public.institution_attendance_policies (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  enabled boolean not null default false,
  teacher_accounts_only boolean not null default true,
  allow_local_relay boolean not null default true,
  allow_gps_fallback boolean not null default true,
  relay_local_url text,
  max_gps_accuracy_m integer not null default 60
    check (max_gps_accuracy_m between 10 and 500),
  gps_grace_m integer not null default 25
    check (gps_grace_m between 0 and 100),
  relay_proof_ttl_seconds integer not null default 180
    check (relay_proof_ttl_seconds between 30 and 600),
  relay_presence_secret text not null default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.institution_attendance_policies
  add column if not exists relay_local_url text;

create table if not exists public.institution_attendance_zones (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 150 check (radius_m between 30 and 5000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists institution_attendance_zones_active_idx
  on public.institution_attendance_zones(institution_id, is_active);

alter table public.teacher_sessions
  add column if not exists presence_verified boolean,
  add column if not exists presence_method text,
  add column if not exists presence_zone_id uuid references public.institution_attendance_zones(id) on delete set null,
  add column if not exists presence_distance_m integer,
  add column if not exists presence_accuracy_m integer,
  add column if not exists presence_checked_at timestamptz;

-- Les séances historiques restent valides. Les nouvelles séances démarrent non vérifiées.
update public.teacher_sessions
set presence_verified = true,
    presence_method = coalesce(presence_method, 'historical')
where presence_verified is null;

alter table public.teacher_sessions
  alter column presence_verified set default false,
  alter column presence_verified set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'teacher_sessions_presence_method_check'
      and conrelid = 'public.teacher_sessions'::regclass
  ) then
    alter table public.teacher_sessions
      add constraint teacher_sessions_presence_method_check
      check (
        presence_method is null or presence_method in (
          'gps', 'local_relay', 'admin_override', 'not_required', 'historical'
        )
      );
  end if;
end $$;

alter table public.institution_attendance_policies enable row level security;
alter table public.institution_attendance_zones enable row level security;

comment on table public.institution_attendance_policies is
  'Politique de contrôle de présence lors du démarrage des appels enseignants.';
comment on table public.institution_attendance_zones is
  'Zones géographiques autorisées d’un établissement; plusieurs campus sont possibles.';
comment on column public.institution_attendance_policies.relay_presence_secret is
  'Secret serveur/relais; ne jamais exposer dans une réponse destinée aux enseignants.';
