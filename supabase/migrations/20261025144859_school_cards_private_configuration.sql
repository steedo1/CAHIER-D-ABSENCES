-- Applied to production after the owner's explicit approval on 2026-10-25; version 20261025144859. Do not reapply manually.
-- Additive module storage. No student, enrollment, bulletin or institution write.
begin;
create table public.school_card_settings (
  institution_id uuid primary key references public.institutions(id),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration)='object' and octet_length(configuration::text) < 32768),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
create table public.school_card_revocations (
  institution_id uuid not null references public.institutions(id),
  enrollment_id uuid not null references public.class_enrollments(id),
  revoked boolean not null default true,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (institution_id,enrollment_id)
);
create table public.school_card_audit (
  id bigint generated always as identity primary key,
  institution_id uuid not null references public.institutions(id),
  actor_id uuid not null,
  action text not null,
  subject_id uuid,
  revision integer,
  created_at timestamptz not null default now()
);
create index school_card_audit_institution_created on public.school_card_audit(institution_id,created_at desc);
alter table public.school_card_settings enable row level security;
alter table public.school_card_revocations enable row level security;
alter table public.school_card_audit enable row level security;
-- No browser/anon policies. Server guard is mandatory before every service call.
revoke all on public.school_card_settings,public.school_card_revocations,public.school_card_audit from public,anon,authenticated;
grant select,insert,update on public.school_card_settings,public.school_card_revocations to service_role;
grant select,insert on public.school_card_audit to service_role;
grant usage,select on sequence public.school_card_audit_id_seq to service_role;

-- Invoker trigger: an audit failure rolls back the configuration/revocation.
create function public.audit_school_card_change() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='school_card_revocations' then
    if not exists (select 1 from public.class_enrollments e where e.id=new.enrollment_id and e.institution_id=new.institution_id) then
      raise exception 'cross_institution_card_revocation';
    end if;
    insert into public.school_card_audit(institution_id,actor_id,action,subject_id)
    values(new.institution_id,new.updated_by,case when new.revoked then 'card_revoked' else 'card_restored' end,new.enrollment_id);
  else
    if tg_op='UPDATE' and new.revision<>old.revision+1 then raise exception 'invalid_card_revision'; end if;
    insert into public.school_card_audit(institution_id,actor_id,action,revision)
    values(new.institution_id,new.updated_by,'configuration_updated',new.revision);
  end if;
  return new;
end; $$;
revoke all on function public.audit_school_card_change() from public,anon,authenticated;
grant execute on function public.audit_school_card_change() to service_role;
create trigger school_card_settings_audit before insert or update on public.school_card_settings for each row execute function public.audit_school_card_change();
create trigger school_card_revocations_audit before insert or update on public.school_card_revocations for each row execute function public.audit_school_card_change();
commit;
