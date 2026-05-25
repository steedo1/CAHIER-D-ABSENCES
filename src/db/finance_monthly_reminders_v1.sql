-- Mon Cahier — Rappels mensuels de solde scolarité / internat
-- À exécuter une seule fois dans Supabase SQL Editor avant d’activer le cron.

begin;

create extension if not exists pgcrypto;

alter table public.institution_notification_channel_settings
  add column if not exists sms_communication_enabled boolean not null default true,
  add column if not exists sms_finance_reminders_enabled boolean not null default false;

comment on column public.institution_notification_channel_settings.sms_communication_enabled is
  'Autorise les SMS des campagnes de communication, indépendamment des SMS de notes.';

comment on column public.institution_notification_channel_settings.sms_finance_reminders_enabled is
  'Autorise les SMS de rappel mensuel des soldes financiers scolarité/internat, indépendamment des SMS de notes.';

create table if not exists public.finance_monthly_reminder_runs (
  id uuid primary key default gen_random_uuid(),
  month_key text not null,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('push', 'sms')),
  balance_scolarite numeric not null default 0,
  balance_internat numeric not null default 0,
  balance_total numeric not null default 0,
  notification_queue_id uuid null,
  created_at timestamptz not null default now(),
  unique (month_key, institution_id, student_id, parent_id, channel)
);

create index if not exists finance_monthly_reminder_runs_institution_month_idx
  on public.finance_monthly_reminder_runs (institution_id, month_key);

create index if not exists finance_monthly_reminder_runs_student_month_idx
  on public.finance_monthly_reminder_runs (student_id, month_key);

comment on table public.finance_monthly_reminder_runs is
  'Journal anti-doublon des rappels mensuels de solde scolarité/internat envoyés par push ou SMS.';

commit;
