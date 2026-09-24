\set ON_ERROR_STOP on
begin;

-- Minimal production-shaped schema for exercising the actual migration in
-- PostgreSQL. The enclosing transaction leaves the test database untouched.
create role anon;
create role authenticated;
create role service_role;
create schema finance;

create table public.classes (
  id uuid primary key,
  institution_id uuid not null
);
create table public.student_persons (id uuid primary key);
create table public.students (
  id uuid primary key,
  institution_id uuid not null,
  student_person_id uuid references public.student_persons(id) on delete set null
);
create table public.class_enrollments (
  id uuid primary key,
  institution_id uuid not null,
  class_id uuid not null references public.classes(id),
  student_id uuid not null references public.students(id) on delete cascade,
  end_date date
);
create table public.attendance_marks (
  id uuid primary key,
  student_id uuid not null references public.students(id) on delete cascade
);
create table public.ai_training_samples (
  id uuid primary key,
  student_id uuid not null
);

create table finance.student_charges (
  id uuid primary key,
  school_id uuid not null,
  student_id uuid not null
);
create table finance.receipts (
  id uuid primary key,
  school_id uuid not null,
  student_id uuid not null
);
create table finance.receipt_allocations (
  id uuid primary key,
  receipt_id uuid not null references finance.receipts(id) on delete cascade,
  student_charge_id uuid not null references finance.student_charges(id) on delete restrict
);
create table finance.online_payment_intents (
  id uuid primary key,
  school_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  receipt_id uuid references finance.receipts(id) on delete set null,
  student_charge_id uuid not null references finance.student_charges(id) on delete restrict
);
create table finance.reminder_logs (
  id uuid primary key,
  school_id uuid not null,
  student_id uuid not null,
  student_charge_id uuid references finance.student_charges(id) on delete set null
);

\ir ../supabase/migrations/20260924002003_atomic_student_removal.sql

insert into public.classes values
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
insert into public.student_persons values
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005');
insert into public.students values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005');
insert into public.class_enrollments values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011', null),
  ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000013', null),
  ('00000000-0000-0000-0000-000000000034', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000014', null);
insert into public.attendance_marks values
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000011');
insert into public.ai_training_samples values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000054', '00000000-0000-0000-0000-000000000014');
insert into finance.student_charges values
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014');
insert into finance.receipts values
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014');
insert into finance.receipt_allocations values
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000021'),
  ('00000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000024');
insert into finance.online_payment_intents values
  ('00000000-0000-0000-0000-000000000027', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000021'),
  ('00000000-0000-0000-0000-000000000028', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000024');
insert into finance.reminder_logs values
  ('00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021'),
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000024');

do $$
declare
  v_result jsonb;
  v_rejected boolean := false;
begin
  if has_function_privilege('anon', 'public.delete_student_completely_v1(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_student_completely_v1(uuid,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.delete_student_completely_v1(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'incorrect RPC privileges';
  end if;

  begin
    perform public.delete_student_completely_v1(
      '00000000-0000-0000-0000-000000000099',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000011'
    );
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'invalid_class' then raise; end if;
    v_rejected := true;
  end;
  if not v_rejected or not exists (
    select 1 from public.students where id = '00000000-0000-0000-0000-000000000011'
  ) then
    raise exception 'foreign institution was not rejected safely';
  end if;

  v_result := public.delete_student_completely_v1(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000011'
  );
  if v_result->>'deleted' <> 'true' or (v_result->>'receipts_deleted')::integer <> 1
     or (v_result->>'charges_deleted')::integer <> 1
     or v_result->>'student_person_deleted' <> 'false' then
    raise exception 'incorrect successful deletion result: %', v_result;
  end if;
  if exists (select 1 from public.students where id = '00000000-0000-0000-0000-000000000011')
     or exists (select 1 from public.class_enrollments where student_id = '00000000-0000-0000-0000-000000000011')
     or exists (select 1 from public.attendance_marks where student_id = '00000000-0000-0000-0000-000000000011')
     or exists (select 1 from public.ai_training_samples where student_id = '00000000-0000-0000-0000-000000000011')
     or exists (select 1 from finance.receipts where student_id = '00000000-0000-0000-0000-000000000011')
     or exists (select 1 from finance.student_charges where student_id = '00000000-0000-0000-0000-000000000011')
     or exists (select 1 from finance.reminder_logs where student_id = '00000000-0000-0000-0000-000000000011')
     or exists (select 1 from finance.online_payment_intents where student_id = '00000000-0000-0000-0000-000000000011')
     or exists (select 1 from finance.receipt_allocations where id = '00000000-0000-0000-0000-000000000023') then
    raise exception 'student data survived successful deletion';
  end if;
  if not exists (select 1 from public.students where id = '00000000-0000-0000-0000-000000000012')
     or not exists (select 1 from public.student_persons where id = '00000000-0000-0000-0000-000000000003') then
    raise exception 'another student or shared person was deleted';
  end if;

  v_result := public.delete_student_completely_v1(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000013'
  );
  if v_result->>'student_person_deleted' <> 'true'
     or exists (select 1 from public.student_persons where id = '00000000-0000-0000-0000-000000000004') then
    raise exception 'isolated student person was not deleted';
  end if;
end;
$$;

create function public.block_student_delete_for_test() returns trigger
language plpgsql as $$
begin
  if old.id = '00000000-0000-0000-0000-000000000014' then
    raise exception 'blocked_for_test';
  end if;
  return old;
end;
$$;
create trigger block_student_delete_for_test before delete on public.students
for each row execute function public.block_student_delete_for_test();

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.delete_student_completely_v1(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000014'
    );
  exception when others then
    if sqlerrm <> 'blocked_for_test' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'expected failure did not occur'; end if;
  if not exists (select 1 from public.students where id = '00000000-0000-0000-0000-000000000014')
     or not exists (select 1 from public.ai_training_samples where student_id = '00000000-0000-0000-0000-000000000014')
     or not exists (select 1 from finance.receipts where student_id = '00000000-0000-0000-0000-000000000014')
     or not exists (select 1 from finance.student_charges where student_id = '00000000-0000-0000-0000-000000000014')
     or not exists (select 1 from finance.reminder_logs where student_id = '00000000-0000-0000-0000-000000000014')
     or not exists (select 1 from finance.online_payment_intents where student_id = '00000000-0000-0000-0000-000000000014')
     or not exists (select 1 from finance.receipt_allocations where id = '00000000-0000-0000-0000-000000000026') then
    raise exception 'a failed deletion lost student or finance data';
  end if;
end;
$$;

select 'student permanent removal smoke test PASS' as result;
rollback;
