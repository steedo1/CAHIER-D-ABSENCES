-- Draft migration, not installed in production. Isolated from tuition/grades/attendance.
begin;
create table public.parent_connect_school_settings (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  enforcement_enabled boolean not null default false,
  activations_paused boolean not null default false,
  approved_academic_year text,
  approved_ends_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.parent_connect_bulk_operations (
  id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  reference text not null check(length(trim(reference)) between 2 and 160),
  student_ids uuid[] not null, eligible_count integer not null, skipped_no_matricule integer not null,
  ends_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index parent_connect_bulk_school on public.parent_connect_bulk_operations(institution_id,academic_year,created_at desc);
create table public.parent_connect_accounts (
  student_id uuid not null references public.students(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null, source text not null check(source in ('payment','school_cover')),
  bulk_operation_id uuid references public.parent_connect_bulk_operations(id),
  starts_at timestamptz not null, ends_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (institution_id,student_id,academic_year), check(ends_at>starts_at)
);
create index parent_connect_accounts_student on public.parent_connect_accounts(student_id);
create index parent_connect_accounts_school_expiry on public.parent_connect_accounts(institution_id,academic_year,ends_at);
create table public.parent_connect_payments (
  id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  academic_year text not null, student_name text not null, matricule text not null,
  payer_name text not null check(length(trim(payer_name)) between 2 and 160),
  payment_method text not null check(payment_method in ('cash','wave','orange_money','mtn_money','bank_transfer')),
  payment_reference text not null default '' check(length(payment_reference)<=160),
  amount integer not null default 2000 check(amount=2000),
  school_share integer not null default 500 check(school_share=500),
  nexa_share integer not null default 1500 check(nexa_share=1500),
  receipt_no text not null unique, starts_at timestamptz not null, ends_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(institution_id,student_id,academic_year), check(ends_at>starts_at)
);
create index parent_connect_payments_school_date on public.parent_connect_payments(institution_id,created_at desc);
create index parent_connect_payments_student on public.parent_connect_payments(student_id);
create table public.parent_connect_remittances (
  id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  amount integer not null check(amount>0 and amount%1500=0),
  reference text not null check(length(trim(reference)) between 2 and 160),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index parent_connect_remittances_school_date on public.parent_connect_remittances(institution_id,created_at desc);
create table public.parent_connect_credit_grants (
  id uuid primary key,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null, quantity integer not null check(quantity>0 and quantity<=1000000),
  amount_received bigint not null check(amount_received=quantity::bigint*1500),
  reference text not null check(length(trim(reference)) between 2 and 160),
  remittance_id uuid unique references public.parent_connect_remittances(id),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now()
);
create index parent_connect_grants_school_year on public.parent_connect_credit_grants(institution_id,academic_year);
alter table public.parent_connect_school_settings enable row level security;
alter table public.parent_connect_accounts enable row level security;
alter table public.parent_connect_payments enable row level security;
alter table public.parent_connect_remittances enable row level security;
alter table public.parent_connect_credit_grants enable row level security;
alter table public.parent_connect_bulk_operations enable row level security;
revoke all on public.parent_connect_school_settings,public.parent_connect_accounts,public.parent_connect_payments,public.parent_connect_remittances,public.parent_connect_credit_grants,public.parent_connect_bulk_operations from public,anon,authenticated;
grant all on public.parent_connect_school_settings,public.parent_connect_accounts,public.parent_connect_payments,public.parent_connect_remittances,public.parent_connect_credit_grants,public.parent_connect_bulk_operations to service_role;

create function public.parent_connect_assert_actor(p_actor uuid,p_institution uuid,p_super_only boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.user_roles ur left join public.profiles p on p.id=ur.profile_id
    where ur.profile_id=p_actor and (ur.role::text='super_admin' or
      (not p_super_only and ur.role::text in ('admin','finance_manager','founder') and coalesce(ur.institution_id,p.institution_id)=p_institution)))
  then raise exception 'PARENT_CONNECT_FORBIDDEN'; end if;
end; $$;
create function public.parent_connect_current_year(p_institution uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_year public.academic_years%rowtype;
begin
  if (select count(*) from public.academic_years where institution_id=p_institution and is_current)=1 then
    select * into v_year from public.academic_years where institution_id=p_institution and is_current;
  else raise exception 'PARENT_CONNECT_YEAR_REQUIRED'; end if;
  if v_year.end_date is null or v_year.end_date<current_date then raise exception 'PARENT_CONNECT_YEAR_REQUIRED'; end if;
  return jsonb_build_object('code',v_year.code,'end_date',v_year.end_date,'ends_at',((v_year.end_date+1)::timestamp at time zone 'UTC'));
end; $$;

create function public.parent_connect_collect(p_institution_id uuid,p_student_id uuid,p_actor_id uuid,
  p_operation_id uuid,p_payer_name text,p_payment_method text,p_payment_reference text,
  p_expected_ends_at timestamptz default null,p_academic_year text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_student public.students%rowtype; v_existing public.parent_connect_payments%rowtype;
  v_current timestamptz; v_year jsonb; v_end timestamptz; v_credits bigint; v_payment public.parent_connect_payments%rowtype;
begin
  perform public.parent_connect_assert_actor(p_actor_id,p_institution_id);
  if p_operation_id is null or p_student_id is null or p_academic_year is null then raise exception 'PARENT_CONNECT_INVALID_PAYMENT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_institution_id::text,2026));
  select * into v_existing from public.parent_connect_payments where id=p_operation_id;
  if found then
    if v_existing.institution_id<>p_institution_id or v_existing.student_id is distinct from p_student_id
      or v_existing.academic_year<>p_academic_year or v_existing.payer_name<>trim(p_payer_name)
      or v_existing.payment_method<>p_payment_method or v_existing.payment_reference<>trim(coalesce(p_payment_reference,''))
    then raise exception 'PARENT_CONNECT_OPERATION_CONFLICT'; end if;
    return to_jsonb(v_existing);
  end if;
  v_year:=public.parent_connect_current_year(p_institution_id);
  if v_year->>'code'<>p_academic_year then raise exception 'PARENT_CONNECT_YEAR_CHANGED'; end if;
  if exists(select 1 from public.parent_connect_school_settings where institution_id=p_institution_id and activations_paused)
    then raise exception 'PARENT_CONNECT_ACTIVATIONS_PAUSED'; end if;
  select * into v_student from public.students where id=p_student_id and institution_id=p_institution_id for update;
  if not found then raise exception 'PARENT_CONNECT_STUDENT_NOT_FOUND'; end if;
  if v_student.lifecycle_status is not null and v_student.lifecycle_status<>'active' then raise exception 'PARENT_CONNECT_STUDENT_NOT_FOUND'; end if;
  if not exists(select 1 from public.class_enrollments ce join public.classes cl on cl.id=ce.class_id where ce.student_id=p_student_id and ce.institution_id=p_institution_id and ce.end_date is null and cl.institution_id=p_institution_id and cl.academic_year=p_academic_year) then raise exception 'PARENT_CONNECT_STUDENT_NOT_ENROLLED'; end if;
  if nullif(trim(v_student.matricule),'') is null then raise exception 'PARENT_CONNECT_MATRICULE_REQUIRED'; end if;
  select ends_at into v_current from public.parent_connect_accounts where student_id=p_student_id and institution_id=p_institution_id and academic_year=p_academic_year;
  if found then raise exception 'PARENT_CONNECT_ALREADY_COVERED'; end if;
  if v_current is distinct from p_expected_ends_at then raise exception 'PARENT_CONNECT_STALE_SUBSCRIPTION'; end if;
  select coalesce(sum(quantity),0) into v_credits from public.parent_connect_credit_grants where institution_id=p_institution_id and academic_year=p_academic_year;
  v_credits:=v_credits-(select count(*) from public.parent_connect_payments where institution_id=p_institution_id and academic_year=p_academic_year);
  if v_credits<1 then raise exception 'PARENT_CONNECT_NO_CREDITS'; end if;
  select least(approved_ends_at,(v_year->>'ends_at')::timestamptz) into v_end from public.parent_connect_school_settings where institution_id=p_institution_id and approved_academic_year=p_academic_year and approved_ends_at>now();
  if v_end is null then raise exception 'PARENT_CONNECT_YEAR_REQUIRED'; end if;
  insert into public.parent_connect_payments(id,institution_id,student_id,academic_year,student_name,matricule,payer_name,payment_method,payment_reference,receipt_no,starts_at,ends_at,created_by)
    values(p_operation_id,p_institution_id,p_student_id,p_academic_year,coalesce(nullif(trim(concat_ws(' ',v_student.last_name,v_student.first_name)),''),'Élève'),v_student.matricule,trim(p_payer_name),p_payment_method,trim(coalesce(p_payment_reference,'')),
      'PC-'||p_academic_year||'-'||upper(replace(p_operation_id::text,'-','')),now(),v_end,p_actor_id) returning * into v_payment;
  insert into public.parent_connect_accounts(student_id,institution_id,academic_year,source,starts_at,ends_at)
    values(p_student_id,p_institution_id,p_academic_year,'payment',now(),v_end);
  return to_jsonb(v_payment);
end; $$;

-- A school declaration is pending. It never creates credits or proves money received.
create function public.parent_connect_remit(p_institution_id uuid,p_actor_id uuid,p_operation_id uuid,p_amount integer,p_reference text,p_academic_year text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_existing public.parent_connect_remittances%rowtype; v_row public.parent_connect_remittances%rowtype; v_year jsonb;
begin
  perform public.parent_connect_assert_actor(p_actor_id,p_institution_id);
  if p_operation_id is null or p_amount is null or p_amount<=0 or p_amount%1500<>0 or length(trim(coalesce(p_reference,''))) not between 2 and 160 or p_academic_year is null then raise exception 'PARENT_CONNECT_INVALID_REMITTANCE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_institution_id::text,2026));
  select * into v_existing from public.parent_connect_remittances where id=p_operation_id;
  if found then
    if v_existing.institution_id<>p_institution_id or v_existing.academic_year<>p_academic_year or v_existing.amount<>p_amount or v_existing.reference<>trim(p_reference) then raise exception 'PARENT_CONNECT_OPERATION_CONFLICT'; end if;
    return to_jsonb(v_existing);
  end if;
  v_year:=public.parent_connect_current_year(p_institution_id);
  if v_year->>'code'<>p_academic_year then raise exception 'PARENT_CONNECT_YEAR_CHANGED'; end if;
  insert into public.parent_connect_remittances(id,institution_id,academic_year,amount,reference,created_by)
    values(p_operation_id,p_institution_id,p_academic_year,p_amount,trim(p_reference),p_actor_id) returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create function public.parent_connect_grant_credits(p_institution_id uuid,p_actor_id uuid,p_operation_id uuid,
  p_academic_year text,p_quantity integer,p_reference text,p_remittance_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_existing public.parent_connect_credit_grants%rowtype; v_request public.parent_connect_remittances%rowtype; v_row public.parent_connect_credit_grants%rowtype; v_year jsonb;
begin
  perform public.parent_connect_assert_actor(p_actor_id,p_institution_id,true);
  if p_operation_id is null or p_quantity is null or p_quantity<1 or p_quantity>1000000 or length(trim(coalesce(p_reference,''))) not between 2 and 160 then raise exception 'PARENT_CONNECT_INVALID_GRANT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_institution_id::text,2026));
  select * into v_existing from public.parent_connect_credit_grants where id=p_operation_id;
  if found then
    if v_existing.institution_id<>p_institution_id or v_existing.academic_year<>p_academic_year or v_existing.quantity<>p_quantity or v_existing.reference<>trim(p_reference) or v_existing.remittance_id is distinct from p_remittance_id then raise exception 'PARENT_CONNECT_OPERATION_CONFLICT'; end if;
    return to_jsonb(v_existing);
  end if;
  v_year:=public.parent_connect_current_year(p_institution_id);
  if v_year->>'code'<>p_academic_year then raise exception 'PARENT_CONNECT_YEAR_CHANGED'; end if;
  if p_remittance_id is not null then
    select * into v_request from public.parent_connect_remittances where id=p_remittance_id and institution_id=p_institution_id and academic_year=p_academic_year;
    if not found or v_request.amount<>p_quantity::bigint*1500 then raise exception 'PARENT_CONNECT_INVALID_GRANT'; end if;
    if exists(select 1 from public.parent_connect_credit_grants where remittance_id=p_remittance_id) then raise exception 'PARENT_CONNECT_ALREADY_CONFIRMED'; end if;
  end if;
  insert into public.parent_connect_school_settings(institution_id,enforcement_enabled,approved_academic_year,approved_ends_at,updated_by)
    values(p_institution_id,true,p_academic_year,(v_year->>'ends_at')::timestamptz,p_actor_id)
    on conflict(institution_id) do update set enforcement_enabled=true,approved_academic_year=excluded.approved_academic_year,
      approved_ends_at=case when parent_connect_school_settings.approved_academic_year=excluded.approved_academic_year then least(parent_connect_school_settings.approved_ends_at,excluded.approved_ends_at) else excluded.approved_ends_at end,updated_by=p_actor_id,updated_at=now();
  insert into public.parent_connect_credit_grants(id,institution_id,academic_year,quantity,amount_received,reference,remittance_id,confirmed_by)
    values(p_operation_id,p_institution_id,p_academic_year,p_quantity,p_quantity::bigint*1500,trim(p_reference),p_remittance_id,p_actor_id) returning * into v_row;
  return to_jsonb(v_row);
end; $$;

create function public.parent_connect_bulk_activate(p_institution_id uuid,p_actor_id uuid,p_operation_id uuid,p_academic_year text,p_reference text,p_expected_count integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_year jsonb; v_ids uuid[]; v_missing integer; v_existing public.parent_connect_bulk_operations%rowtype; v_row public.parent_connect_bulk_operations%rowtype;
begin
  perform public.parent_connect_assert_actor(p_actor_id,p_institution_id,true);
  if p_operation_id is null or length(trim(coalesce(p_reference,''))) not between 2 and 160 then raise exception 'PARENT_CONNECT_INVALID_BULK'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_institution_id::text,2026));
  select * into v_existing from public.parent_connect_bulk_operations where id=p_operation_id;
  if found then
    if v_existing.institution_id<>p_institution_id or v_existing.academic_year<>p_academic_year or v_existing.reference<>trim(p_reference) or v_existing.eligible_count<>p_expected_count then raise exception 'PARENT_CONNECT_OPERATION_CONFLICT'; end if;
    return to_jsonb(v_existing)||jsonb_build_object('activated_count',cardinality(v_existing.student_ids));
  end if;
  v_year:=public.parent_connect_current_year(p_institution_id);
  if v_year->>'code'<>p_academic_year then raise exception 'PARENT_CONNECT_YEAR_CHANGED'; end if;
  perform st.id from public.students st where st.institution_id=p_institution_id and (st.lifecycle_status is null or st.lifecycle_status='active') and exists(
    select 1 from public.class_enrollments ce join public.classes cl on cl.id=ce.class_id
    where ce.student_id=st.id and ce.institution_id=p_institution_id and ce.end_date is null and cl.institution_id=p_institution_id and cl.academic_year=p_academic_year) for update;
  select coalesce(array_agg(st.id order by st.id) filter(where nullif(trim(st.matricule),'') is not null),'{}'::uuid[]),
    count(*) filter(where nullif(trim(st.matricule),'') is null)::integer into v_ids,v_missing
    from public.students st where st.institution_id=p_institution_id and (st.lifecycle_status is null or st.lifecycle_status='active') and exists(
      select 1 from public.class_enrollments ce join public.classes cl on cl.id=ce.class_id
      where ce.student_id=st.id and ce.institution_id=p_institution_id and ce.end_date is null and cl.institution_id=p_institution_id and cl.academic_year=p_academic_year);
  if p_expected_count is distinct from cardinality(v_ids) or cardinality(v_ids)=0 then raise exception 'PARENT_CONNECT_ROSTER_CHANGED'; end if;
  insert into public.parent_connect_bulk_operations(id,institution_id,academic_year,reference,student_ids,eligible_count,skipped_no_matricule,ends_at,created_by)
    values(p_operation_id,p_institution_id,p_academic_year,trim(p_reference),v_ids,cardinality(v_ids),v_missing,(v_year->>'ends_at')::timestamptz,p_actor_id) returning * into v_row;
  insert into public.parent_connect_accounts(student_id,institution_id,academic_year,source,bulk_operation_id,starts_at,ends_at)
    select id,p_institution_id,p_academic_year,'school_cover',p_operation_id,now(),v_row.ends_at from unnest(v_ids) id
    on conflict(institution_id,student_id,academic_year) do nothing;
  insert into public.parent_connect_school_settings(institution_id,enforcement_enabled,approved_academic_year,approved_ends_at,updated_by)
    values(p_institution_id,true,p_academic_year,(v_year->>'ends_at')::timestamptz,p_actor_id) on conflict(institution_id) do update set enforcement_enabled=true,approved_academic_year=p_academic_year,approved_ends_at=(v_year->>'ends_at')::timestamptz,updated_by=p_actor_id,updated_at=now();
  return to_jsonb(v_row)||jsonb_build_object('activated_count',cardinality(v_ids));
end; $$;

create function public.parent_connect_summary(p_institution_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  with current_year as(select code from public.academic_years where institution_id=p_institution_id and is_current),
  credits as(select coalesce(sum(quantity),0) as n,coalesce(sum(amount_received),0) as amount from public.parent_connect_credit_grants where institution_id=p_institution_id and academic_year in(select code from current_year)),
  payments as(select count(*) as n,coalesce(sum(amount),0) as total,coalesce(sum(school_share),0) as school,coalesce(sum(nexa_share),0) as nexa from public.parent_connect_payments where institution_id=p_institution_id and academic_year in(select code from current_year))
  select jsonb_build_object('subscriptions_active',(select count(*) from public.parent_connect_accounts a join public.students st on st.id=a.student_id and st.institution_id=a.institution_id where a.institution_id=p_institution_id and a.academic_year in(select code from current_year) and a.ends_at>now() and exists(select 1 from public.academic_years y join public.parent_connect_school_settings cfg on cfg.institution_id=y.institution_id where y.institution_id=a.institution_id and y.is_current and y.code=a.academic_year and cfg.approved_academic_year=y.code and cfg.approved_ends_at>now() and ((y.end_date+1)::timestamp at time zone 'UTC')>now())),
    'payments_count',payments.n,'collected',payments.total,'school_share',payments.school,'nexa_share',payments.nexa,
    'credits_granted',credits.n,'credits_used',payments.n,'credits_available',credits.n-payments.n,'nexa_received',credits.amount,
    'pending_remittances',(select coalesce(sum(r.amount),0) from public.parent_connect_remittances r where r.institution_id=p_institution_id and r.academic_year in(select code from current_year) and not exists(select 1 from public.parent_connect_credit_grants g where g.remittance_id=r.id)),
    'school_covered',(select count(*) from public.parent_connect_accounts a join public.students st on st.id=a.student_id and st.institution_id=a.institution_id where a.institution_id=p_institution_id and a.academic_year in(select code from current_year) and a.source='school_cover' and a.ends_at>now() and exists(select 1 from public.academic_years y join public.parent_connect_school_settings cfg on cfg.institution_id=y.institution_id where y.institution_id=a.institution_id and y.is_current and y.code=a.academic_year and cfg.approved_academic_year=y.code and cfg.approved_ends_at>now() and ((y.end_date+1)::timestamp at time zone 'UTC')>now()))) from credits,payments;
$$;
create function public.parent_connect_access_status(p_student_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('enforced',coalesce(cfg.enforcement_enabled,false),'ends_at',case when account.ends_at is not null and cfg.approved_ends_at is not null and yr.end_date is not null and cfg.approved_academic_year=yr.code and (select count(*) from public.academic_years where institution_id=st.institution_id and is_current)=1 then least(account.ends_at,cfg.approved_ends_at,((yr.end_date+1)::timestamp at time zone 'UTC')) end)
    from public.students st left join public.parent_connect_school_settings cfg on cfg.institution_id=st.institution_id
    left join public.academic_years yr on yr.institution_id=st.institution_id and yr.is_current
    left join public.parent_connect_accounts account on account.student_id=st.id and account.institution_id=st.institution_id and account.academic_year=yr.code where st.id=p_student_id;
$$;
revoke all on function public.parent_connect_assert_actor(uuid,uuid,boolean),public.parent_connect_current_year(uuid),public.parent_connect_collect(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text),public.parent_connect_remit(uuid,uuid,uuid,integer,text,text),public.parent_connect_grant_credits(uuid,uuid,uuid,text,integer,text,uuid),public.parent_connect_bulk_activate(uuid,uuid,uuid,text,text,integer),public.parent_connect_summary(uuid),public.parent_connect_access_status(uuid) from public,anon,authenticated;
grant execute on function public.parent_connect_assert_actor(uuid,uuid,boolean),public.parent_connect_current_year(uuid),public.parent_connect_collect(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text),public.parent_connect_remit(uuid,uuid,uuid,integer,text,text),public.parent_connect_grant_credits(uuid,uuid,uuid,text,integer,text,uuid),public.parent_connect_bulk_activate(uuid,uuid,uuid,text,text,integer),public.parent_connect_summary(uuid),public.parent_connect_access_status(uuid) to service_role;

create function public.parent_connect_super_overview(p_search text default '',p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
  with selected as(select i.id,i.name from public.institutions i where i.name ilike '%'||p_search||'%' order by i.name,i.id limit 30 offset greatest(0,p_offset))
  select jsonb_build_object('total',(select count(*) from public.institutions where name ilike '%'||p_search||'%'),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'summary',public.parent_connect_summary(s.id)) order by s.name,s.id) from selected s),'[]'::jsonb));
$$;
create function public.parent_connect_roster(p_institution_id uuid,p_academic_year text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('eligible_count',count(*) filter(where nullif(trim(st.matricule),'') is not null),
    'skipped_no_matricule',count(*) filter(where nullif(trim(st.matricule),'') is null))
  from public.students st where st.institution_id=p_institution_id and (st.lifecycle_status is null or st.lifecycle_status='active') and exists(
    select 1 from public.class_enrollments ce join public.classes cl on cl.id=ce.class_id where ce.student_id=st.id and ce.institution_id=p_institution_id and ce.end_date is null and cl.institution_id=p_institution_id and cl.academic_year=p_academic_year);
$$;
revoke all on function public.parent_connect_super_overview(text,integer),public.parent_connect_roster(uuid,text) from public,anon,authenticated;
grant execute on function public.parent_connect_super_overview(text,integer),public.parent_connect_roster(uuid,text) to service_role;
-- Page the enrolled roster in SQL: no oversized HTTP list of student UUIDs.
create function public.parent_connect_students(p_institution_id uuid,p_academic_year text,p_search text default '',p_class_id uuid default null,p_level text default '',p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
  with matches as (
    select st.id,st.matricule,st.first_name,st.last_name,
      (select string_agg(distinct cl.label, ', ' order by cl.label) from public.class_enrollments ce join public.classes cl on cl.id=ce.class_id
        where ce.student_id=st.id and ce.institution_id=p_institution_id and ce.end_date is null and cl.institution_id=p_institution_id and cl.academic_year=p_academic_year
        and (p_class_id is null or cl.id=p_class_id) and (p_level='' or coalesce(cl.formation_level_code,cl.level::text,'')=p_level)) as class_label
    from public.students st where st.institution_id=p_institution_id and (st.lifecycle_status is null or st.lifecycle_status='active')
      and exists(select 1 from public.class_enrollments ce join public.classes cl on cl.id=ce.class_id
        where ce.student_id=st.id and ce.institution_id=p_institution_id and ce.end_date is null and cl.institution_id=p_institution_id and cl.academic_year=p_academic_year
        and (p_class_id is null or cl.id=p_class_id) and (p_level='' or coalesce(cl.formation_level_code,cl.level::text,'')=p_level))
      and not exists(select 1 from unnest(regexp_split_to_array(trim(p_search),'\s+')) term where term<>''
        and not (concat_ws(' ',st.last_name,st.first_name) ilike '%'||term||'%' or coalesce(st.matricule,'') ilike '%'||term||'%'))
  ), selected as(select * from matches order by last_name,first_name,id limit 40 offset greatest(0,p_offset))
  select jsonb_build_object('total',(select count(*) from matches),'items',coalesce((select jsonb_agg(to_jsonb(s) order by s.last_name,s.first_name,s.id) from selected s),'[]'::jsonb));
$$;
revoke all on function public.parent_connect_students(uuid,text,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.parent_connect_students(uuid,text,text,uuid,text,integer) to service_role;
commit;
