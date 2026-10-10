-- Isolated Parent Connect ledger. No alteration to finance.*, grades or attendance.
-- Run before releasing this feature. Schools keep legacy access until enabled explicitly.
begin;
create table public.parent_connect_school_settings (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  enforcement_enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.parent_connect_accounts (
  student_id uuid not null references public.students(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (institution_id,student_id),
  check (ends_at > starts_at)
);
create index parent_connect_accounts_school_expiry on public.parent_connect_accounts(institution_id,ends_at);
create index parent_connect_accounts_student on public.parent_connect_accounts(student_id);
create table public.parent_connect_payments (
  id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  student_name text not null,
  matricule text not null,
  payer_name text not null check (length(trim(payer_name)) between 2 and 160),
  payment_method text not null check (payment_method in ('cash','wave','orange_money','mtn_money','bank_transfer')),
  payment_reference text not null default '' check (length(payment_reference) <= 160),
  amount integer not null default 2000 check (amount = 2000),
  school_share integer not null default 500 check (school_share = 500),
  nexa_share integer not null default 1500 check (nexa_share = 1500),
  receipt_no text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index parent_connect_payments_school_date on public.parent_connect_payments(institution_id,created_at desc);
create index parent_connect_payments_student on public.parent_connect_payments(student_id,created_at desc);
create table public.parent_connect_remittances (
  id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  amount integer not null check (amount > 0),
  reference text not null check (length(trim(reference)) between 2 and 160),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index parent_connect_remittances_school_date on public.parent_connect_remittances(institution_id,created_at desc);

-- All access goes through authenticated, tenant-scoped server endpoints.
alter table public.parent_connect_school_settings enable row level security;
alter table public.parent_connect_accounts enable row level security;
alter table public.parent_connect_payments enable row level security;
alter table public.parent_connect_remittances enable row level security;
revoke all on public.parent_connect_school_settings, public.parent_connect_accounts, public.parent_connect_payments, public.parent_connect_remittances from public, anon, authenticated;
grant all on public.parent_connect_school_settings, public.parent_connect_accounts, public.parent_connect_payments, public.parent_connect_remittances to service_role;

create function public.parent_connect_collect(
  p_institution_id uuid, p_student_id uuid, p_actor_id uuid,
  p_operation_id uuid, p_payer_name text, p_payment_method text,
  p_payment_reference text, p_expected_ends_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_student public.students%rowtype;
  v_existing public.parent_connect_payments%rowtype;
  v_current timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_payment public.parent_connect_payments%rowtype;
begin
  if not exists (
    select 1 from public.user_roles ur
    left join public.profiles p on p.id = ur.profile_id
    where ur.profile_id = p_actor_id and (
      ur.role::text = 'super_admin' or
      (ur.role::text in ('admin','finance_manager','founder') and
        coalesce(ur.institution_id, p.institution_id) = p_institution_id)
    )
  ) then raise exception 'PARENT_CONNECT_FORBIDDEN'; end if;
  if p_operation_id is null or p_student_id is null or p_institution_id is null then
    raise exception 'PARENT_CONNECT_INVALID_PAYMENT';
  end if;
  -- Same lock for all payments/remittances of a school: atomic balances and replay.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_institution_id::text, 2026));
  select * into v_existing from public.parent_connect_payments where id = p_operation_id;
  if found then
    if v_existing.institution_id <> p_institution_id or v_existing.student_id is distinct from p_student_id
      or v_existing.payer_name <> trim(p_payer_name) or v_existing.payment_method <> p_payment_method
      or v_existing.payment_reference <> trim(coalesce(p_payment_reference,'')) then
      raise exception 'PARENT_CONNECT_OPERATION_CONFLICT';
    end if;
    return to_jsonb(v_existing);
  end if;
  select * into v_student from public.students where id = p_student_id and institution_id = p_institution_id for update;
  if not found then raise exception 'PARENT_CONNECT_STUDENT_NOT_FOUND'; end if;
  if v_student.matricule is null or trim(v_student.matricule) = '' then
    raise exception 'PARENT_CONNECT_MATRICULE_REQUIRED';
  end if;
  select ends_at into v_current from public.parent_connect_accounts where student_id = p_student_id and institution_id = p_institution_id;
  if v_current is distinct from p_expected_ends_at then
    raise exception 'PARENT_CONNECT_STALE_SUBSCRIPTION';
  end if;
  v_start := greatest(now(), coalesce(v_current, now()));
  v_end := v_start + interval '12 months';
  insert into public.parent_connect_payments (
    id,institution_id,student_id,student_name,matricule,payer_name,payment_method,payment_reference,
    receipt_no,starts_at,ends_at,created_by
  ) values (
    p_operation_id,p_institution_id,p_student_id,
    coalesce(nullif(trim(concat_ws(' ',v_student.last_name,v_student.first_name)),''),'Élève'),
    v_student.matricule,trim(p_payer_name),p_payment_method,trim(coalesce(p_payment_reference,'')),
    'PC-' || to_char(now(),'YYYY') || '-' || upper(replace(p_operation_id::text,'-','')),
    v_start,v_end,p_actor_id
  ) returning * into v_payment;
  insert into public.parent_connect_accounts(student_id,institution_id,starts_at,ends_at)
    values(p_student_id,p_institution_id,now(),v_end)
    on conflict(institution_id,student_id) do update set ends_at = excluded.ends_at, updated_at = now();
  return to_jsonb(v_payment);
end;
$$;
revoke all on function public.parent_connect_collect(uuid,uuid,uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.parent_connect_collect(uuid,uuid,uuid,uuid,text,text,text,timestamptz) to service_role;

create function public.parent_connect_remit(
  p_institution_id uuid,p_actor_id uuid,p_operation_id uuid,p_amount integer,p_reference text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_due bigint; v_existing public.parent_connect_remittances%rowtype; v_row public.parent_connect_remittances%rowtype;
begin
  if not exists (
    select 1 from public.user_roles ur left join public.profiles p on p.id = ur.profile_id
    where ur.profile_id = p_actor_id and (ur.role::text = 'super_admin' or
      (ur.role::text in ('admin','finance_manager','founder') and coalesce(ur.institution_id,p.institution_id) = p_institution_id))
  ) then raise exception 'PARENT_CONNECT_FORBIDDEN'; end if;
  if p_operation_id is null or p_amount is null or p_amount <= 0 or p_reference is null
    or length(trim(p_reference)) not between 2 and 160 then raise exception 'PARENT_CONNECT_INVALID_REMITTANCE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_institution_id::text,2026));
  select * into v_existing from public.parent_connect_remittances where id = p_operation_id;
  if found then
    if v_existing.institution_id <> p_institution_id or v_existing.amount <> p_amount or v_existing.reference <> trim(p_reference) then
      raise exception 'PARENT_CONNECT_OPERATION_CONFLICT';
    end if;
    return to_jsonb(v_existing);
  end if;
  select coalesce(sum(nexa_share),0) into v_due from public.parent_connect_payments where institution_id = p_institution_id;
  v_due := v_due - (select coalesce(sum(amount),0) from public.parent_connect_remittances where institution_id = p_institution_id);
  if p_amount > v_due then raise exception 'PARENT_CONNECT_REMITTANCE_EXCEEDS_DUE'; end if;
  insert into public.parent_connect_remittances(id,institution_id,amount,reference,created_by)
    values(p_operation_id,p_institution_id,p_amount,trim(p_reference),p_actor_id) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.parent_connect_remit(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.parent_connect_remit(uuid,uuid,uuid,integer,text) to service_role;
create function public.parent_connect_summary(p_institution_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object(
    'subscriptions_active',(select count(*) from public.parent_connect_accounts account join public.students student on student.id=account.student_id and student.institution_id=account.institution_id where account.institution_id=p_institution_id and account.ends_at>now()),
    'payments_count',(select count(*) from public.parent_connect_payments where institution_id=p_institution_id),
    'collected',(select coalesce(sum(amount),0) from public.parent_connect_payments where institution_id=p_institution_id),
    'school_share',(select coalesce(sum(school_share),0) from public.parent_connect_payments where institution_id=p_institution_id),
    'nexa_share',(select coalesce(sum(nexa_share),0) from public.parent_connect_payments where institution_id=p_institution_id),
    'remitted',(select coalesce(sum(amount),0) from public.parent_connect_remittances where institution_id=p_institution_id)
  );
$$;
revoke all on function public.parent_connect_summary(uuid) from public,anon,authenticated;
grant execute on function public.parent_connect_summary(uuid) to service_role;
-- One indexed lookup per protected parent endpoint; no auth/user polling.
create function public.parent_connect_access_status(p_student_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('enforced',coalesce(cfg.enforcement_enabled,false),'ends_at',account.ends_at)
  from public.students st
  left join public.parent_connect_school_settings cfg on cfg.institution_id=st.institution_id
  left join public.parent_connect_accounts account on account.student_id=st.id and account.institution_id=st.institution_id
  where st.id=p_student_id;
$$;
revoke all on function public.parent_connect_access_status(uuid) from public,anon,authenticated;
grant execute on function public.parent_connect_access_status(uuid) to service_role;
commit;
