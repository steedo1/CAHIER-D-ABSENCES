-- =========================================================
-- Mon Cahier — Module Communication V1
-- Parents : tous / cycle / niveau / classe
-- Personnel : tout le personnel / enseignants / professeurs principaux
-- =========================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.communication_campaigns (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text,
  created_by uuid references public.profiles(id) on delete set null,

  audience_type text not null check (audience_type in ('parents', 'staff')),
  target_type text not null,
  target_value text,
  target_label text,

  channel text not null check (channel in ('push', 'sms', 'push_sms')),
  title text not null,
  body text not null,

  status text not null default 'queued' check (status in ('draft', 'queued', 'sending', 'sent', 'partial_failed', 'failed', 'cancelled')),
  recipient_count integer not null default 0,
  push_queued_count integer not null default 0,
  sms_queued_count integer not null default 0,

  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.communication_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.communication_campaigns(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,

  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('parent', 'staff', 'teacher', 'head_teacher')),
  display_name text,
  phone_e164 text,
  related_student_ids uuid[] not null default array[]::uuid[],
  roles text[] not null default array[]::text[],

  push_status text not null default 'not_requested',
  sms_status text not null default 'not_requested',
  error_message text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_communication_campaigns_institution_created
  on public.communication_campaigns(institution_id, created_at desc);

create index if not exists idx_communication_recipients_campaign
  on public.communication_recipients(campaign_id);

create index if not exists idx_communication_recipients_profile
  on public.communication_recipients(recipient_profile_id);

-- On ne force pas RLS ici : les routes serveur utilisent la service role.
-- Si RLS est activée plus tard, créer des policies lecture admin par établissement.

commit;
