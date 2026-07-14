-- Mon Cahier — Module Distinctions v1
-- Historique des palmarès élèves et enseignants.

create table if not exists public.distinction_publications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  category text not null,
  title text not null,
  academic_year text null,
  period_code text null,
  date_from date null,
  date_to date null,
  class_ids uuid[] not null default '{}',
  recipient_count integer not null default 0 check (recipient_count >= 0),
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists distinction_publications_institution_created_idx
  on public.distinction_publications (institution_id, created_at desc);

create index if not exists distinction_publications_category_idx
  on public.distinction_publications (institution_id, category, academic_year, period_code);

alter table public.distinction_publications enable row level security;

-- Les routes serveur utilisent la clé service. Ces politiques permettent aussi
-- une lecture directe future, strictement limitée à l'établissement du profil.
drop policy if exists distinction_publications_select_own_institution on public.distinction_publications;
create policy distinction_publications_select_own_institution
  on public.distinction_publications
  for select
  using (
    institution_id = (
      select p.institution_id
      from public.profiles p
      where p.id = auth.uid()
      limit 1
    )
  );

drop policy if exists distinction_publications_insert_admin on public.distinction_publications;
create policy distinction_publications_insert_admin
  on public.distinction_publications
  for insert
  with check (
    institution_id = (
      select p.institution_id
      from public.profiles p
      where p.id = auth.uid()
      limit 1
    )
    and exists (
      select 1
      from public.user_roles ur
      where ur.profile_id = auth.uid()
        and ur.institution_id = distinction_publications.institution_id
        and ur.role in ('admin', 'super_admin')
    )
  );

-- Codes unitaires de vérification : un code par élève distingué ou par prix enseignant.
create table if not exists public.distinction_verifications (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.distinction_publications(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  public_code text not null default replace(gen_random_uuid()::text, '-', ''),
  recipient_key text not null,
  recipient_type text not null check (recipient_type in ('student', 'teacher')),
  recipient_name text not null,
  class_label text null,
  award_title text not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (publication_id, recipient_key),
  unique (public_code)
);

create index if not exists distinction_verifications_public_code_idx
  on public.distinction_verifications (public_code);

create index if not exists distinction_verifications_publication_idx
  on public.distinction_verifications (publication_id);

alter table public.distinction_verifications enable row level security;

-- Aucune lecture publique directe n'est ouverte en RLS. La page de vérification
-- passe par une route serveur qui ne renvoie que les informations strictement utiles.
drop policy if exists distinction_verifications_select_own_institution on public.distinction_verifications;
create policy distinction_verifications_select_own_institution
  on public.distinction_verifications
  for select
  using (
    institution_id = (
      select p.institution_id
      from public.profiles p
      where p.id = auth.uid()
      limit 1
    )
  );
