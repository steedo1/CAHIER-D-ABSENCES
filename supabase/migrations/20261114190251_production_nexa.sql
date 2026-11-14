begin;

-- The Auth claim nexa_production is intentionally not a PostgreSQL role.
-- PostgREST cannot assume it, including for legacy RPCs accessible to PUBLIC.
-- The web application verifies the Auth identity and uses scoped service queries.
create table public.nexa_production_accounts (
  user_id uuid primary key references auth.users(id),
  email text not null,
  status text not null default 'active' check (status in ('active','disabled','revoked')),
  permissions text[] not null check (permissions <@ array['cards.read','cards.orders','cards.generate','cards.download']::text[]),
  all_schools boolean not null default false,
  institution_ids uuid[] not null default '{}',
  actor_id uuid not null,
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
create table public.nexa_card_preparations (
  institution_id uuid not null references public.institutions(id),
  academic_year text not null,
  student_id uuid not null,
  actor_id uuid not null,
  prepared_at timestamptz not null default now(),
  primary key (institution_id, academic_year, student_id)
);
create table public.nexa_card_orders (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  academic_year text not null,
  student_ids uuid[] not null check (cardinality(student_ids) between 1 and 10000),
  selection_hash text not null,
  status text not null default 'pending' check (status in ('pending','preparing','ready','completed','cancelled')),
  submitted_by uuid not null,
  actor_id uuid not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  unique(id,institution_id,academic_year)
);
create unique index nexa_open_order_selection on public.nexa_card_orders(institution_id,academic_year,selection_hash)
where status not in ('completed','cancelled');
create index nexa_orders_by_school on public.nexa_card_orders(institution_id,academic_year,created_at desc,id);
create table public.nexa_card_archives (
  id uuid primary key,
  institution_id uuid not null references public.institutions(id),
  academic_year text not null,
  order_id uuid,
  previous_id uuid unique,
  version integer not null check (version > 0),
  batch_key text not null,
  student_ids uuid[] not null check (cardinality(student_ids) between 1 and 40),
  students jsonb not null check (jsonb_typeof(students)='array' and octet_length(students::text)<65536 and jsonb_array_length(students)=cardinality(student_ids)),
  object_path text not null unique,
  size_bytes integer not null check(size_bytes between 1 and 12582912),
  format text not null check (format in ('pvc','a4')),
  flip text not null check (flip in ('long','short')),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  review_after timestamptz not null default (now() + interval '24 months'),
  unique(id,institution_id,academic_year),
  unique(batch_key,version),
  foreign key (order_id,institution_id,academic_year) references public.nexa_card_orders(id,institution_id,academic_year),
  foreign key (previous_id,institution_id,academic_year) references public.nexa_card_archives(id,institution_id,academic_year),
  check ((version=1) = (previous_id is null))
);
create index nexa_archives_by_school on public.nexa_card_archives(institution_id,academic_year,created_at desc,id);
create index nexa_archives_review_after on public.nexa_card_archives(review_after);
create index nexa_archives_by_order on public.nexa_card_archives(order_id) where order_id is not null;
create table public.nexa_production_audit (
  id bigint generated always as identity primary key,
  institution_id uuid references public.institutions(id),
  academic_year text,
  actor_id uuid not null,
  action text not null,
  subject_id uuid not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index nexa_audit_by_subject on public.nexa_production_audit(subject_id,created_at desc,id);
create index nexa_audit_by_school on public.nexa_production_audit(institution_id,academic_year,created_at desc,id);
create index nexa_audit_by_date on public.nexa_production_audit(created_at desc,id);
alter table public.nexa_production_accounts enable row level security;
alter table public.nexa_card_preparations enable row level security;
alter table public.nexa_card_orders enable row level security;
alter table public.nexa_card_archives enable row level security;
alter table public.nexa_production_audit enable row level security;
revoke all on public.nexa_production_accounts, public.nexa_card_preparations, public.nexa_card_orders,
  public.nexa_card_archives, public.nexa_production_audit from public, anon, authenticated;
grant select,insert,update on public.nexa_production_accounts, public.nexa_card_preparations, public.nexa_card_orders to service_role;
grant select,insert on public.nexa_card_archives, public.nexa_production_audit to service_role;
grant usage on sequence public.nexa_production_audit_id_seq to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('nexa-production-cards','nexa-production-cards',false,12582912,array['application/pdf']);
-- Hosted Storage owns storage.objects. Fail closed if an existing grant via
-- policy could expose private card files. This deployment uses default deny.
do $$ begin
  if not exists (select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity)
    or exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and permissive='PERMISSIVE' and roles && array['public','anon','authenticated']::name[])
    or exists (select 1 from storage.buckets where id='signatures' and public) then
    raise exception 'private_school_card_storage_requires_review';
  end if;
end $$;
-- The live legacy helper has no internal authorization and has no repository
-- callers. Keep its service-role grant and remove browser escalation.
revoke execute on function public.fn_upsert_role(uuid,uuid,text) from public,anon,authenticated;

create function public.nexa_audit_changes() returns trigger
language plpgsql security invoker set search_path='' as $$
declare operation text;
begin
  if tg_table_name='nexa_production_accounts' then
    if tg_op='UPDATE' and (old.status='revoked' or new.revision<>old.revision+1) then
      raise exception 'invalid_account_transition' using errcode='23514';
    end if;
    insert into public.nexa_production_audit(actor_id,action,subject_id,details)
    values(new.actor_id,lower(case when tg_op='INSERT' then 'created' else 'updated' end),new.user_id,
      jsonb_build_object('status',new.status,'permissions',new.permissions,'allSchools',new.all_schools,'institutionIds',new.institution_ids));
  elsif tg_table_name='nexa_card_orders' then
    if tg_op='UPDATE' then
      if new.revision<>old.revision+1 or not (
        (old.status='pending' and new.status in ('preparing','cancelled')) or
        (old.status='preparing' and new.status in ('ready','cancelled')) or
        (old.status='ready' and new.status in ('preparing','completed','cancelled'))
      ) then raise exception 'invalid_order_transition' using errcode='23514'; end if;
      if new.status='ready' and exists (
        select 1 from unnest(new.student_ids) as s(id) where not exists (
          select 1 from public.nexa_card_archives a where a.order_id=new.id and s.id=any(a.student_ids)
        )
      ) then raise exception 'order_production_incomplete' using errcode='23514'; end if;
      operation := 'order_updated';
    else
      operation := 'order_submitted';
    end if;
    insert into public.nexa_production_audit(institution_id,academic_year,actor_id,action,subject_id,details)
    values(new.institution_id,new.academic_year,new.actor_id,operation,new.id,
      jsonb_build_object('status',new.status,'count',cardinality(new.student_ids)));
  else
    if new.order_id is not null then
      perform 1 from public.nexa_card_orders o where o.id=new.order_id and o.status in ('pending','preparing','ready')
        and o.institution_id=new.institution_id and o.academic_year=new.academic_year
        and new.student_ids <@ o.student_ids for share;
      if not found and new.previous_id is null then
        raise exception 'invalid_production_order' using errcode='23514';
      end if;
    end if;
    if new.previous_id is not null and not exists (
      select 1 from public.nexa_card_archives p where p.id=new.previous_id and p.version+1=new.version
        and p.batch_key=new.batch_key and p.student_ids=new.student_ids and p.order_id is not distinct from new.order_id
        and p.format=new.format and p.flip=new.flip
    ) then raise exception 'invalid_archive_version' using errcode='23514'; end if;
    insert into public.nexa_production_audit(institution_id,academic_year,actor_id,action,subject_id,details)
    values(new.institution_id,new.academic_year,new.actor_id,case when new.previous_id is null then 'generated' else 'regenerated' end,new.id,
      jsonb_build_object('version',new.version,'previousId',new.previous_id,'orderId',new.order_id,'count',cardinality(new.student_ids),'bytes',new.size_bytes));
  end if;
  return new;
end $$;
revoke all on function public.nexa_audit_changes() from public,anon,authenticated;
grant execute on function public.nexa_audit_changes() to service_role;
create trigger nexa_account_audit after insert or update on public.nexa_production_accounts for each row execute function public.nexa_audit_changes();
create trigger nexa_order_audit after insert or update on public.nexa_card_orders for each row execute function public.nexa_audit_changes();
create trigger nexa_archive_audit after insert on public.nexa_card_archives for each row execute function public.nexa_audit_changes();

create function public.nexa_prepare_cards(p_school uuid, p_year text, p_actor uuid, p_students uuid[], p_order boolean)
returns uuid language plpgsql security invoker set search_path='' as $$
declare selection uuid[]; selection_key text; order_id uuid; prepared_count integer;
begin
  select array_agg(distinct id order by id) into selection from unnest(p_students) as s(id);
  if selection is null or cardinality(selection)>10000 then raise exception 'invalid_selection' using errcode='23514'; end if;
  insert into public.nexa_card_preparations(institution_id,academic_year,student_id,actor_id)
  select p_school,p_year,id,p_actor from unnest(selection) as s(id)
  on conflict do nothing;
  get diagnostics prepared_count = row_count;
  if not p_order then
    if prepared_count > 0 then
      insert into public.nexa_production_audit(institution_id,academic_year,actor_id,action,subject_id,details)
      values(p_school,p_year,p_actor,'cards_prepared',p_school,jsonb_build_object('count',prepared_count));
    end if;
    return null;
  end if;

  selection_key := encode(sha256(convert_to(selection::text,'UTF8')), 'hex');
  -- Serialize matching submissions, even if they arrive from separate browsers.
  perform pg_advisory_xact_lock(hashtextextended(p_school::text || p_year || selection_key, 0));
  select id into order_id from public.nexa_card_orders where institution_id=p_school and academic_year=p_year
    and selection_hash=selection_key and status not in ('completed','cancelled');
  if order_id is null then
    insert into public.nexa_card_orders(institution_id,academic_year,student_ids,selection_hash,submitted_by,actor_id)
    values(p_school,p_year,selection,selection_key,p_actor,p_actor) returning id into order_id;
  end if;
  return order_id;
end $$;
revoke all on function public.nexa_prepare_cards(uuid,text,uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.nexa_prepare_cards(uuid,text,uuid,uuid[],boolean) to service_role;
commit;
