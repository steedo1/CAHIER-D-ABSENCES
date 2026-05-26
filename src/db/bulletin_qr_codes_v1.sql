-- Thème : Vérification publique des bulletins par QR code
-- Table : public.bulletin_qr_codes
-- À exécuter dans Supabase SQL Editor AVANT de régénérer les bulletins avec QR.

create extension if not exists pgcrypto;

create table if not exists public.bulletin_qr_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  bulletin_key text,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  revoked boolean not null default false,
  scan_count integer not null default 0,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bulletin_qr_codes
  add column if not exists code text,
  add column if not exists bulletin_key text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists expires_at timestamptz,
  add column if not exists revoked boolean not null default false,
  add column if not exists scan_count integer not null default 0,
  add column if not exists last_seen_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.bulletin_qr_codes
set payload = '{}'::jsonb
where payload is null;

create unique index if not exists bulletin_qr_codes_code_uidx
  on public.bulletin_qr_codes (upper(trim(code)))
  where code is not null and trim(code) <> '';

create index if not exists bulletin_qr_codes_bulletin_key_idx
  on public.bulletin_qr_codes (bulletin_key, created_at desc)
  where revoked = false;

create index if not exists bulletin_qr_codes_payload_student_idx
  on public.bulletin_qr_codes ((payload->>'studentId'), created_at desc)
  where revoked = false;

create or replace function public.set_bulletin_qr_codes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bulletin_qr_codes_updated_at on public.bulletin_qr_codes;
create trigger trg_bulletin_qr_codes_updated_at
before update on public.bulletin_qr_codes
for each row
execute function public.set_bulletin_qr_codes_updated_at();

select
  count(*) as total_qr_codes,
  count(*) filter (where code is null or trim(code) = '') as codes_vides,
  count(*) filter (where payload is null or payload = '{}'::jsonb) as payloads_vides,
  count(*) filter (where revoked = true) as revoked_count
from public.bulletin_qr_codes;
