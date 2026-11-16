-- One annual charge per pupil, on the administrative class. The second
-- teaching assignment contributes its own class rate when recorded.
create or replace function finance.epc_tuition_2026_2027()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_programs jsonb;
  v_admin_track jsonb;
  v_label text;
  v_gross numeric;
  v_second_amount numeric;
  v_links integer;
  v_second_rates integer;
  v_paid numeric;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  select i.settings_json #> '{school_student_programs_v1,years,2026-2027,classes}',
    fs.label, fs.amount
  into v_programs, v_label, v_gross
  from public.institutions i
  join finance.fee_schedules fs on fs.school_id = i.id
  join finance.fee_categories fc on fc.id = fs.fee_category_id and fc.school_id = i.id
  join public.classes c on c.id = fs.class_id and c.institution_id = i.id
  where i.id = new.school_id and i.code_unique = 'E020684'
    and fs.id = new.fee_schedule_id and fs.class_id = new.class_id
    and fs.fee_category_id = new.fee_category_id
    and c.academic_year = '2026-2027' and fs.academic_year = c.academic_year
    and fc.code = 'scolarite' and fc.is_active and fs.is_active
    and fs.amount_mode = 'fixed'
    and fs.applies_when_affecte is null and fs.applies_when_boarder is null;
  if not found then
    return new;
  end if;

  v_admin_track := coalesce(
    v_programs -> new.class_id::text -> 'students' -> new.student_id::text,
    v_programs -> new.class_id::text -> 'tracks'
  );
  select count(distinct c.id), count(fs.id), sum(fs.amount)
    into v_links, v_second_rates, v_second_amount
  from jsonb_each(v_programs) p
  join public.classes c on c.id::text = p.key and c.institution_id = new.school_id
    and c.academic_year = '2026-2027' and c.id <> new.class_id
  left join finance.fee_schedules fs on fs.class_id = c.id and fs.school_id = new.school_id
    and fs.academic_year = c.academic_year and fs.fee_category_id = new.fee_category_id
    and fs.is_active and fs.amount_mode = 'fixed'
    and fs.applies_when_affecte is null and fs.applies_when_boarder is null
  where p.value -> 'linkedStudentIds' ? new.student_id::text
    and (v_admin_track, p.value -> 'tracks') in
      (('["french"]'::jsonb, '["arabic"]'::jsonb), ('["arabic"]'::jsonb, '["french"]'::jsonb));

  if v_links > 1 or v_links <> v_second_rates then
    raise exception 'Scolarité EPC : le barème du second enseignement doit être vérifié.';
  end if;

  new.base_amount := v_gross + coalesce(v_second_amount, 0);
  new.label := case when v_links = 1 then 'Scolarité 2026-2027 - Français et Arabe' else v_label end;
  new.sync_key := new.fee_schedule_id::text;

  if tg_op = 'UPDATE' then
    select coalesce(sum(ra.amount), 0) into v_paid
    from finance.receipt_allocations ra
    join finance.receipts r on r.id = ra.receipt_id and r.receipt_status = 'posted'
    where ra.student_charge_id = new.id and r.school_id = new.school_id;

    -- The two approved exceptions represent final amounts, even when the
    -- original charge is reconciled or moved to another class.
    update finance.student_charge_adjustments a
    set amount = case
      when a.reason = 'Exonération totale de scolarité accordée par l’EPC Dimbokro pour 2026-2027'
        then -new.base_amount
      else 14000 - new.base_amount
    end
    where a.school_id = new.school_id and a.student_charge_id = new.id
      and a.adjustment_type = 'discount'
      and a.reason in (
        'Exonération totale de scolarité accordée par l’EPC Dimbokro pour 2026-2027',
        'Remise partielle sur la scolarité EPC Dimbokro 2026-2027. Montant dû fixé à 14 000 FCFA.'
      )
      and a.amount is distinct from case
        when a.reason = 'Exonération totale de scolarité accordée par l’EPC Dimbokro pour 2026-2027'
          then -new.base_amount
        else 14000 - new.base_amount
      end;
    if not exists (
      select from finance.student_charge_adjustments a
      where a.school_id = new.school_id and a.student_charge_id = new.id
        and a.adjustment_type = 'discount' and a.reason in (
          'Exonération totale de scolarité accordée par l’EPC Dimbokro pour 2026-2027',
          'Remise partielle sur la scolarité EPC Dimbokro 2026-2027. Montant dû fixé à 14 000 FCFA.'
        )
    ) then
      new.base_amount := greatest(new.base_amount, v_paid);
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function finance.epc_tuition_2026_2027() from public, anon, authenticated;

do $trigger$
declare
  v_school uuid;
begin
  select id into strict v_school from public.institutions where code_unique = 'E020684';
  execute format(
    'create trigger epc_tuition_2026_2027 before insert or update of base_amount, class_id, fee_schedule_id, fee_category_id, status on finance.student_charges
     for each row when (new.school_id = %L::uuid and new.academic_year = %L and new.fee_schedule_id is not null)
     execute function finance.epc_tuition_2026_2027()',
    v_school, '2026-2027'
  );
end;
$trigger$;

do $backfill$
declare
  v_school uuid;
  v_year uuid;
  v_existing integer;
begin
  select i.id, ay.id into strict v_school, v_year
  from public.institutions i
  join public.academic_years ay on ay.institution_id = i.id
  join public.institution_finance_module_settings fm on fm.institution_id = i.id
  where i.code_unique = 'E020684' and ay.code = '2026-2027' and fm.finance_fees_enabled
  for update of i;

  create temporary table epc_tuition_backfill on commit drop as
    select e.student_id, e.class_id, f.id schedule_id, f.fee_category_id,
      f.label, f.amount, f.due_date
    from public.class_enrollments e
    join public.classes c on c.id = e.class_id and c.institution_id = v_school and c.academic_year = '2026-2027'
    join public.students s on s.id = e.student_id and s.institution_id = v_school
      and (s.lifecycle_status is null or s.lifecycle_status = 'active')
    join finance.fee_schedules f on f.class_id = e.class_id and f.school_id = v_school
      and f.academic_year = '2026-2027' and f.is_active and f.amount_mode = 'fixed'
      and f.applies_when_affecte is null and f.applies_when_boarder is null
    join finance.fee_categories k on k.id = f.fee_category_id and k.school_id = v_school and k.code = 'scolarite' and k.is_active
    where e.institution_id = v_school and e.end_date is null;

  if (select count(*) <> 232 or count(distinct student_id) <> count(*) from epc_tuition_backfill)
    or exists (
      select from public.class_enrollments e
      join public.classes c on c.id = e.class_id and c.institution_id = v_school and c.academic_year = '2026-2027'
      join public.students s on s.id = e.student_id and s.institution_id = v_school
        and (s.lifecycle_status is null or s.lifecycle_status = 'active')
      where e.institution_id = v_school and e.end_date is null
      and not exists (select from epc_tuition_backfill b where b.student_id = e.student_id and b.class_id = e.class_id)
    )
  then raise exception 'Vérifier les inscriptions et les barèmes EPC avant la mise à jour.'; end if;

  select count(*) into v_existing
  from finance.student_charges sc
  join epc_tuition_backfill b on b.student_id = sc.student_id
    and b.class_id = sc.class_id and b.fee_category_id = sc.fee_category_id and b.schedule_id = sc.fee_schedule_id
  where sc.school_id = v_school and sc.academic_year = '2026-2027' and sc.status <> 'cancelled';

  if v_existing <> 127 or (
    select count(*) from finance.student_charges sc
    where sc.school_id = v_school and (sc.academic_year = '2026-2027' or sc.academic_year_id = v_year)
      and sc.status <> 'cancelled'
      and exists (select from epc_tuition_backfill b where b.fee_category_id = sc.fee_category_id)
  ) <> v_existing then raise exception 'Vérifier les lignes de scolarité EPC existantes.'; end if;

  update finance.student_charges sc
  set base_amount = b.amount, updated_at = now()
  from epc_tuition_backfill b
  where sc.school_id = v_school and sc.academic_year = '2026-2027'
    and sc.student_id = b.student_id and sc.fee_schedule_id = b.schedule_id and sc.status <> 'cancelled';

  insert into finance.student_charges
    (school_id, academic_year_id, academic_year, student_id, class_id, fee_schedule_id, fee_category_id,
     sync_key, label, base_amount, due_date, notes)
  select v_school, v_year, '2026-2027', b.student_id, b.class_id, b.schedule_id, b.fee_category_id,
    b.schedule_id::text, b.label, b.amount, b.due_date, 'Scolarité annuelle EPC Dimbokro 2026-2027.'
  from epc_tuition_backfill b
  where not exists (
    select from finance.student_charges sc
    where sc.school_id = v_school and sc.academic_year = '2026-2027'
      and sc.student_id = b.student_id and sc.fee_category_id = b.fee_category_id and sc.status <> 'cancelled'
  );

  if (select count(*) from finance.v_charge_balances b
      join epc_tuition_backfill p on p.student_id = b.student_id and p.schedule_id = b.fee_schedule_id
      where b.school_id = v_school and b.academic_year_id = v_year and b.computed_status <> 'cancelled') <> 232
    or (select count(*) from finance.v_charge_balances b
      where b.school_id = v_school and b.academic_year_id = v_year
        and b.computed_status <> 'cancelled' and b.label = 'Scolarité 2026-2027 - Français et Arabe') <> 228
    or (select count(*) from finance.student_charge_adjustments a
      join finance.v_charge_balances b on b.id = a.student_charge_id
      where a.school_id = v_school and b.academic_year_id = v_year and b.computed_status <> 'cancelled'
        and a.reason = 'Exonération totale de scolarité accordée par l’EPC Dimbokro pour 2026-2027'
        and b.net_amount = 0 and b.balance_due = 0) <> 22
    or (select count(*) from finance.student_charge_adjustments a
      join finance.v_charge_balances b on b.id = a.student_charge_id
      where a.school_id = v_school and b.academic_year_id = v_year and b.computed_status <> 'cancelled'
        and a.reason = 'Remise partielle sur la scolarité EPC Dimbokro 2026-2027. Montant dû fixé à 14 000 FCFA.'
        and b.net_amount = 14000 and b.balance_due = 14000) <> 2
  then raise exception 'Les contrôles de scolarité et de remise EPC ne concordent pas.'; end if;
end;
$backfill$;
