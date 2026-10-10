-- Parent Connect only. Keep historical amounts and grants intact; no SMS or school activation changes.
begin;
alter table public.parent_connect_payments
  drop constraint parent_connect_payments_amount_check,
  drop constraint parent_connect_payments_school_share_check,
  drop constraint parent_connect_payments_nexa_share_check,
  add constraint parent_connect_payments_amount_check check(amount>0),
  add constraint parent_connect_payments_school_share_check check(school_share>=0),
  add constraint parent_connect_payments_nexa_share_check check(nexa_share>0),
  add constraint parent_connect_payments_split_check check(amount::bigint=school_share::bigint+nexa_share::bigint);
alter table public.parent_connect_payments add column credit_grant_id uuid references public.parent_connect_credit_grants(id);
create index parent_connect_payments_credit_grant on public.parent_connect_payments(credit_grant_id);
-- Attribute any historical legacy payments to their already-confirmed grant without changing amounts.
with consumed as (
  select id,institution_id,academic_year,row_number() over(partition by institution_id,academic_year order by created_at,id) as ordinal
  from public.parent_connect_payments
), grants as (
  select id,institution_id,academic_year,quantity,sum(quantity) over(partition by institution_id,academic_year order by confirmed_at,id) as credit_end
  from public.parent_connect_credit_grants
)
update public.parent_connect_payments p set credit_grant_id=g.id from consumed c join grants g
  on g.institution_id=c.institution_id and g.academic_year=c.academic_year and c.ordinal>g.credit_end-g.quantity and c.ordinal<=g.credit_end
where p.id=c.id;
alter table public.parent_connect_remittances
  drop constraint parent_connect_remittances_amount_check,
  add constraint parent_connect_remittances_amount_check check(amount>0);
alter table public.parent_connect_credit_grants
  drop constraint parent_connect_credit_grants_check,
  add constraint parent_connect_credit_grants_check check(amount_received>=quantity and amount_received<=quantity::bigint*2147483647);
create function public.parent_connect_collect_at_price(p_institution_id uuid,p_student_id uuid,p_actor_id uuid,
  p_operation_id uuid,p_payer_name text,p_payment_method text,p_payment_reference text,p_amount integer,
  p_expected_ends_at timestamptz default null,p_academic_year text default null,p_sms_phone_e164 text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_student public.students%rowtype; v_existing public.parent_connect_payments%rowtype;
  v_current timestamptz; v_year jsonb; v_end timestamptz; v_credits bigint; v_unit_price integer; v_grant_id uuid; v_payment public.parent_connect_payments%rowtype;
begin
  perform public.parent_connect_assert_actor(p_actor_id,p_institution_id);
  if p_amount is null or p_amount<1 then raise exception 'PARENT_CONNECT_INVALID_AMOUNT'; end if;
  if p_sms_phone_e164 is null or p_sms_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'PARENT_CONNECT_PHONE_REQUIRED'; end if;
  if p_operation_id is null or p_student_id is null or p_academic_year is null then raise exception 'PARENT_CONNECT_INVALID_PAYMENT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_institution_id::text,2026));
  select * into v_existing from public.parent_connect_payments where id=p_operation_id;
  if found then
    if v_existing.institution_id<>p_institution_id or v_existing.student_id is distinct from p_student_id
      or v_existing.amount<>p_amount
      or v_existing.sms_phone_e164 is distinct from p_sms_phone_e164
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
  -- Each payment records its grant; later grants cannot re-price an already consumed credit.
  select g.id,(g.amount_received/g.quantity + case when used.n < g.amount_received%g.quantity then 1 else 0 end)::integer into v_grant_id,v_unit_price
    from public.parent_connect_credit_grants g cross join lateral (
      select count(*) as n from public.parent_connect_payments p where p.credit_grant_id=g.id
    ) used where g.institution_id=p_institution_id and g.academic_year=p_academic_year
    and g.quantity>used.n
    order by g.confirmed_at,g.id limit 1;
  if v_unit_price is null or p_amount<v_unit_price then raise exception 'PARENT_CONNECT_INVALID_AMOUNT'; end if;
  select least(approved_ends_at,(v_year->>'ends_at')::timestamptz) into v_end from public.parent_connect_school_settings where institution_id=p_institution_id and approved_academic_year=p_academic_year and approved_ends_at>now();
  if v_end is null then raise exception 'PARENT_CONNECT_YEAR_REQUIRED'; end if;
  insert into public.parent_connect_payments(id,institution_id,student_id,academic_year,student_name,matricule,sms_phone_e164,payer_name,payment_method,payment_reference,receipt_no,starts_at,ends_at,created_by,amount,school_share,nexa_share,credit_grant_id)
    values(p_operation_id,p_institution_id,p_student_id,p_academic_year,coalesce(nullif(trim(concat_ws(' ',v_student.last_name,v_student.first_name)),''),'Élève'),v_student.matricule,p_sms_phone_e164,trim(p_payer_name),p_payment_method,trim(coalesce(p_payment_reference,'')),
      'PC-'||p_academic_year||'-'||upper(replace(p_operation_id::text,'-','')),now(),v_end,p_actor_id,p_amount,p_amount-v_unit_price,v_unit_price,v_grant_id) returning * into v_payment;
  insert into public.parent_connect_accounts(student_id,institution_id,academic_year,source,starts_at,ends_at,sms_phone_e164)
    values(p_student_id,p_institution_id,p_academic_year,'payment',now(),v_end,p_sms_phone_e164);
  return to_jsonb(v_payment);
end; $$;
create function public.parent_connect_grant_credits_at_price(p_institution_id uuid,p_actor_id uuid,p_operation_id uuid,
  p_academic_year text,p_quantity integer,p_reference text,p_received_amount bigint,p_remittance_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_existing public.parent_connect_credit_grants%rowtype; v_request public.parent_connect_remittances%rowtype; v_row public.parent_connect_credit_grants%rowtype; v_year jsonb;
begin
  perform public.parent_connect_assert_actor(p_actor_id,p_institution_id,true);
  if p_operation_id is null or p_quantity is null or p_quantity<1 or p_quantity>1000000 or p_received_amount is null or p_received_amount<p_quantity or p_received_amount>p_quantity::bigint*2147483647 or length(trim(coalesce(p_reference,''))) not between 2 and 160 then raise exception 'PARENT_CONNECT_INVALID_GRANT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_institution_id::text,2026));
  select * into v_existing from public.parent_connect_credit_grants where id=p_operation_id;
  if found then
    if v_existing.institution_id<>p_institution_id or v_existing.academic_year<>p_academic_year or v_existing.quantity<>p_quantity or v_existing.amount_received<>p_received_amount or v_existing.reference<>trim(p_reference) or v_existing.remittance_id is distinct from p_remittance_id then raise exception 'PARENT_CONNECT_OPERATION_CONFLICT'; end if;
    return to_jsonb(v_existing);
  end if;
  v_year:=public.parent_connect_current_year(p_institution_id);
  if v_year->>'code'<>p_academic_year then raise exception 'PARENT_CONNECT_YEAR_CHANGED'; end if;
  if p_remittance_id is not null then
    select * into v_request from public.parent_connect_remittances where id=p_remittance_id and institution_id=p_institution_id and academic_year=p_academic_year;
    if not found or v_request.amount<>p_received_amount then raise exception 'PARENT_CONNECT_INVALID_GRANT'; end if;
    if exists(select 1 from public.parent_connect_credit_grants where remittance_id=p_remittance_id) then raise exception 'PARENT_CONNECT_ALREADY_CONFIRMED'; end if;
  end if;
  insert into public.parent_connect_school_settings(institution_id,enforcement_enabled,approved_academic_year,approved_ends_at,updated_by)
    values(p_institution_id,true,p_academic_year,(v_year->>'ends_at')::timestamptz,p_actor_id)
    on conflict(institution_id) do update set enforcement_enabled=true,approved_academic_year=excluded.approved_academic_year,
      approved_ends_at=case when parent_connect_school_settings.approved_academic_year=excluded.approved_academic_year then least(parent_connect_school_settings.approved_ends_at,excluded.approved_ends_at) else excluded.approved_ends_at end,updated_by=p_actor_id,updated_at=now();
  insert into public.parent_connect_credit_grants(id,institution_id,academic_year,quantity,amount_received,reference,remittance_id,confirmed_by)
    values(p_operation_id,p_institution_id,p_academic_year,p_quantity,p_received_amount,trim(p_reference),p_remittance_id,p_actor_id) returning * into v_row;
  return to_jsonb(v_row);
end; $$;
create or replace function public.parent_connect_remit(p_institution_id uuid,p_actor_id uuid,p_operation_id uuid,p_amount integer,p_reference text,p_academic_year text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_existing public.parent_connect_remittances%rowtype; v_row public.parent_connect_remittances%rowtype; v_year jsonb;
begin
  perform public.parent_connect_assert_actor(p_actor_id,p_institution_id);
  if p_operation_id is null or p_amount is null or p_amount<=0 or length(trim(coalesce(p_reference,''))) not between 2 and 160 or p_academic_year is null then raise exception 'PARENT_CONNECT_INVALID_REMITTANCE'; end if;
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
create or replace function public.parent_connect_summary(p_institution_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  with current_year as(select code from public.academic_years where institution_id=p_institution_id and is_current),
  credits as(select coalesce(sum(quantity),0) as n,coalesce(sum(amount_received),0) as amount from public.parent_connect_credit_grants where institution_id=p_institution_id and academic_year in(select code from current_year)),
  payments as(select count(*) as n,coalesce(sum(amount),0) as total,coalesce(sum(school_share),0) as school,coalesce(sum(nexa_share),0) as nexa from public.parent_connect_payments where institution_id=p_institution_id and academic_year in(select code from current_year))
  select jsonb_build_object('subscriptions_active',(select count(*) from public.parent_connect_accounts a join public.students st on st.id=a.student_id and st.institution_id=a.institution_id where a.institution_id=p_institution_id and a.academic_year in(select code from current_year) and a.starts_at<=now() and a.ends_at>now() and (st.lifecycle_status is null or st.lifecycle_status='active') and nullif(trim(st.matricule),'') is not null and exists(select 1 from public.class_enrollments ce join public.classes cl on cl.id=ce.class_id where ce.student_id=st.id and ce.institution_id=a.institution_id and ce.end_date is null and cl.institution_id=a.institution_id and cl.academic_year=a.academic_year) and exists(select 1 from public.academic_years y join public.parent_connect_school_settings cfg on cfg.institution_id=y.institution_id where y.institution_id=a.institution_id and y.is_current and y.code=a.academic_year and cfg.approved_academic_year=y.code and cfg.approved_ends_at>now() and ((y.end_date+1)::timestamp at time zone 'UTC')>now())),
    'payments_count',payments.n,'collected',payments.total,'school_share',payments.school,'nexa_share',payments.nexa,
    'credits_granted',credits.n,'credits_used',payments.n,'credits_available',credits.n-payments.n,'nexa_received',credits.amount,
    'pending_remittances',(select coalesce(sum(r.amount),0) from public.parent_connect_remittances r where r.institution_id=p_institution_id and r.academic_year in(select code from current_year) and not exists(select 1 from public.parent_connect_credit_grants g where g.remittance_id=r.id)),
    'school_covered',(select count(*) from public.parent_connect_accounts a join public.students st on st.id=a.student_id and st.institution_id=a.institution_id where a.institution_id=p_institution_id and a.academic_year in(select code from current_year) and a.source='school_cover' and a.starts_at<=now() and a.ends_at>now() and (st.lifecycle_status is null or st.lifecycle_status='active') and nullif(trim(st.matricule),'') is not null and exists(select 1 from public.class_enrollments ce join public.classes cl on cl.id=ce.class_id where ce.student_id=st.id and ce.institution_id=a.institution_id and ce.end_date is null and cl.institution_id=a.institution_id and cl.academic_year=a.academic_year) and exists(select 1 from public.academic_years y join public.parent_connect_school_settings cfg on cfg.institution_id=y.institution_id where y.institution_id=a.institution_id and y.is_current and y.code=a.academic_year and cfg.approved_academic_year=y.code and cfg.approved_ends_at>now() and ((y.end_date+1)::timestamp at time zone 'UTC')>now()))) from credits,payments;
$$;
-- Legacy clients retain their original behavior while the new UI records explicit actual amounts.
create or replace function public.parent_connect_collect(p_institution_id uuid,p_student_id uuid,p_actor_id uuid,
  p_operation_id uuid,p_payer_name text,p_payment_method text,p_payment_reference text,
  p_expected_ends_at timestamptz default null,p_academic_year text default null,p_sms_phone_e164 text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select public.parent_connect_collect_at_price(p_institution_id,p_student_id,p_actor_id,p_operation_id,p_payer_name,p_payment_method,p_payment_reference,2000,p_expected_ends_at,p_academic_year,p_sms_phone_e164);
$$;
create or replace function public.parent_connect_grant_credits(p_institution_id uuid,p_actor_id uuid,p_operation_id uuid,
  p_academic_year text,p_quantity integer,p_reference text,p_remittance_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select public.parent_connect_grant_credits_at_price(p_institution_id,p_actor_id,p_operation_id,p_academic_year,p_quantity,p_reference,p_quantity::bigint*1500,p_remittance_id);
$$;
revoke all on function public.parent_connect_collect_at_price(uuid,uuid,uuid,uuid,text,text,text,integer,timestamptz,text,text),public.parent_connect_grant_credits_at_price(uuid,uuid,uuid,text,integer,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.parent_connect_collect_at_price(uuid,uuid,uuid,uuid,text,text,text,integer,timestamptz,text,text),public.parent_connect_grant_credits_at_price(uuid,uuid,uuid,text,integer,text,bigint,uuid) to service_role;
commit;
