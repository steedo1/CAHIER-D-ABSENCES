-- Retirer supprime une fiche eleve et ses donnees liees en une seule transaction.
-- Une erreur dans n'importe quelle suppression annule l'ensemble de l'appel RPC.
create or replace function public.delete_student_completely_v1(
  p_institution_id uuid,
  p_class_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student_person_id uuid;
  v_deleted_student_id uuid;
  v_deleted_person_id uuid;
  v_receipts_deleted integer := 0;
  v_charges_deleted integer := 0;
begin
  -- The API checks the signed-in role. Repeat row ownership checks here so
  -- the service-role RPC cannot delete a student through a stale class row.
  perform 1
  from public.classes c
  where c.id = p_class_id
    and c.institution_id = p_institution_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'invalid_class';
  end if;

  select s.student_person_id
    into v_student_person_id
  from public.students s
  where s.id = p_student_id
    and s.institution_id = p_institution_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'student_not_found';
  end if;

  perform 1
  from public.class_enrollments e
  where e.institution_id = p_institution_id
    and e.class_id = p_class_id
    and e.student_id = p_student_id
    and e.end_date is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'not_found_in_class';
  end if;

  -- Finance tables without a student FK need explicit cleanup. Restrict each
  -- deletion to this school; dependent allocations must go before charges.
  delete from finance.online_payment_intents i
  where i.school_id = p_institution_id and i.student_id = p_student_id;

  delete from finance.receipt_allocations a
  using finance.receipts r
  where a.receipt_id = r.id
    and r.school_id = p_institution_id
    and r.student_id = p_student_id;

  delete from finance.receipt_allocations a
  using finance.student_charges c
  where a.student_charge_id = c.id
    and c.school_id = p_institution_id
    and c.student_id = p_student_id;

  delete from finance.reminder_logs l
  where l.school_id = p_institution_id and l.student_id = p_student_id;

  delete from finance.receipts r
  where r.school_id = p_institution_id and r.student_id = p_student_id;
  get diagnostics v_receipts_deleted = row_count;

  delete from finance.student_charges c
  where c.school_id = p_institution_id and c.student_id = p_student_id;
  get diagnostics v_charges_deleted = row_count;

  -- Older installations can lack one of these physical tables. Computed
  -- views are intentionally excluded; they update from their source rows.
  if to_regclass('public.ai_training_samples') is not null then
    delete from public.ai_training_samples where student_id = p_student_id;
  end if;
  if to_regclass('public.ml_student_features_history') is not null then
    delete from public.ml_student_features_history where student_id = p_student_id;
  end if;
  if to_regclass('public.ml_training_labels') is not null then
    delete from public.ml_training_labels where student_id = p_student_id;
  end if;
  if to_regclass('public.whatsapp_outbox') is not null then
    delete from public.whatsapp_outbox where student_id = p_student_id;
  end if;

  -- PostgreSQL cascades delete attendance, grades, enrolments and other
  -- rows with ON DELETE CASCADE. Any FK error rolls back all prior deletes.
  delete from public.students s
  where s.id = p_student_id and s.institution_id = p_institution_id
  returning s.id into v_deleted_student_id;
  if v_deleted_student_id is null then
    raise exception using errcode = 'P0002', message = 'student_delete_not_applied';
  end if;

  -- A longitudinal person may be shared by another school-year student row.
  if v_student_person_id is not null then
    delete from public.student_persons p
    where p.id = v_student_person_id
      and not exists (
        select 1 from public.students s
        where s.student_person_id = v_student_person_id
      )
    returning p.id into v_deleted_person_id;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'student_id', p_student_id,
    'student_person_deleted', v_deleted_person_id is not null,
    'receipts_deleted', v_receipts_deleted,
    'charges_deleted', v_charges_deleted
  );
end;
$$;

revoke all on function public.delete_student_completely_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_student_completely_v1(uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
