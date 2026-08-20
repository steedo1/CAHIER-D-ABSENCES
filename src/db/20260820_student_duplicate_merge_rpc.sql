-- 2026-08-20 — Réconciliation sûre d'une fiche historique matriculée avec
-- une fiche déjà utilisée dans l'année courante.
-- Règle : la fiche courante garde son student_id, ses inscriptions, ses frais
-- et ses reçus. Seul le matricule/identité longitudinale est transféré.

begin;

create or replace function public.promote_current_student_over_historical(
  p_institution_id uuid,
  p_historical_student_id uuid,
  p_current_student_id uuid,
  p_actor_id uuid default null,
  p_academic_year text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, finance, pg_temp
as $$
declare
  v_historical public.students%rowtype;
  v_current public.students%rowtype;
  v_person_id uuid;
  v_historical_name text;
  v_current_name text;
  v_matricule text;
  v_closed_historical integer := 0;
begin
  if p_institution_id is null then
    raise exception 'institution_id_required' using errcode = '22023';
  end if;
  if p_historical_student_id is null or p_current_student_id is null then
    raise exception 'student_ids_required' using errcode = '22023';
  end if;
  if p_historical_student_id = p_current_student_id then
    raise exception 'historical_and_current_are_same' using errcode = '22023';
  end if;

  select * into v_historical
  from public.students
  where id = p_historical_student_id
    and institution_id = p_institution_id
  for update;
  if not found then
    raise exception 'historical_student_not_found' using errcode = 'P0002';
  end if;

  select * into v_current
  from public.students
  where id = p_current_student_id
    and institution_id = p_institution_id
  for update;
  if not found then
    raise exception 'current_student_not_found' using errcode = 'P0002';
  end if;

  v_matricule := nullif(btrim(coalesce(v_historical.matricule, '')), '');
  if v_matricule is null then
    raise exception 'historical_student_has_no_matricule' using errcode = '23514';
  end if;

  if nullif(btrim(coalesce(v_current.matricule, '')), '') is not null
     and btrim(v_current.matricule) <> v_matricule then
    raise exception 'current_student_has_different_matricule' using errcode = '23514';
  end if;

  v_historical_name := upper(regexp_replace(
    btrim(unaccent(coalesce(v_historical.last_name, '') || ' ' || coalesce(v_historical.first_name, ''))),
    '\s+', ' ', 'g'
  ));
  v_current_name := upper(regexp_replace(
    btrim(unaccent(coalesce(v_current.last_name, '') || ' ' || coalesce(v_current.first_name, ''))),
    '\s+', ' ', 'g'
  ));

  if v_historical_name = '' or v_current_name = '' or v_historical_name <> v_current_name then
    raise exception 'student_identity_mismatch' using errcode = '23514';
  end if;

  if p_academic_year is not null and not exists (
    select 1
    from public.class_enrollments ce
    join public.classes cl on cl.id = ce.class_id
    where ce.institution_id = p_institution_id
      and ce.student_id = p_current_student_id
      and ce.end_date is null
      and cl.academic_year = p_academic_year
  ) then
    raise exception 'current_student_not_active_in_target_academic_year' using errcode = '23514';
  end if;

  if p_academic_year is not null and exists (
    select 1
    from public.class_enrollments ce
    join public.classes cl on cl.id = ce.class_id
    where ce.institution_id = p_institution_id
      and ce.student_id = p_historical_student_id
      and ce.end_date is null
      and cl.academic_year = p_academic_year
  ) then
    raise exception 'historical_student_already_active_in_target_academic_year' using errcode = '23505';
  end if;

  -- Si les deux fiches possèdent déjà chacune un student_person différent,
  -- la fiche de l'année courante est la référence. coalesce(current,historical)
  -- conserve donc son identité longitudinale et rattache l'ancienne fiche à celle-ci.

  v_person_id := coalesce(v_current.student_person_id, v_historical.student_person_id);

  -- Clôturer uniquement les inscriptions historiques restées artificiellement actives.
  update public.class_enrollments ce
  set end_date = coalesce(ay.end_date, current_date)
  from public.classes cl
  left join public.academic_years ay
    on ay.institution_id = p_institution_id
   and ay.code = cl.academic_year
  where ce.institution_id = p_institution_id
    and ce.student_id = p_historical_student_id
    and ce.end_date is null
    and ce.class_id = cl.id
    and (p_academic_year is null or cl.academic_year is distinct from p_academic_year);
  get diagnostics v_closed_historical = row_count;

  -- Libérer le matricule sur la fiche de test/historique.
  update public.students
  set matricule = null,
      student_person_id = v_person_id,
      lifecycle_status = 'duplicate_merged',
      lifecycle_status_updated_at = now()
  where id = p_historical_student_id
    and institution_id = p_institution_id;

  -- La fiche courante reste la référence. On complète uniquement les champs
  -- identitaires manquants ; aucune finance et aucune inscription courante ne bouge.
  update public.students
  set matricule = v_matricule,
      birthdate = coalesce(birthdate, v_historical.birthdate),
      gender = coalesce(gender, v_historical.gender),
      birth_place = coalesce(birth_place, v_historical.birth_place),
      nationality = coalesce(nationality, v_historical.nationality),
      photo_url = coalesce(photo_url, v_historical.photo_url),
      photo_path = coalesce(photo_path, v_historical.photo_path),
      photo_updated_at = coalesce(photo_updated_at, v_historical.photo_updated_at),
      student_person_id = v_person_id,
      lifecycle_status = 'active',
      lifecycle_status_updated_at = now()
  where id = p_current_student_id
    and institution_id = p_institution_id;

  if v_person_id is not null then
    update public.student_persons
    set canonical_student_id = p_current_student_id,
        primary_institution_id = coalesce(primary_institution_id, p_institution_id),
        display_name = coalesce(nullif(display_name, ''), nullif(v_current_name, '')),
        updated_at = now()
    where id = v_person_id;
  end if;

  insert into public.student_lifecycle_events (
    student_person_id,
    student_id,
    institution_id,
    academic_year,
    event_type,
    event_date,
    reason,
    details_json,
    created_by
  ) values (
    v_person_id,
    p_current_student_id,
    p_institution_id,
    p_academic_year,
    'duplicate_merge',
    current_date,
    'Réconciliation : la fiche de l’année courante conserve son identité technique et reçoit le matricule historique.',
    jsonb_build_object(
      'historical_student_id', p_historical_student_id,
      'current_student_id', p_current_student_id,
      'matricule', v_matricule,
      'closed_historical_enrollments', v_closed_historical,
      'finance_moved', false,
      'current_enrollment_moved', false
    ),
    p_actor_id
  );

  return jsonb_build_object(
    'ok', true,
    'historical_student_id', p_historical_student_id,
    'current_student_id', p_current_student_id,
    'matricule', v_matricule,
    'closed_historical_enrollments', v_closed_historical,
    'finance_moved', false,
    'current_enrollment_moved', false
  );
end;
$$;

revoke all on function public.promote_current_student_over_historical(uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.promote_current_student_over_historical(uuid, uuid, uuid, uuid, text) from anon;
revoke all on function public.promote_current_student_over_historical(uuid, uuid, uuid, uuid, text) from authenticated;
grant execute on function public.promote_current_student_over_historical(uuid, uuid, uuid, uuid, text) to service_role;

comment on function public.promote_current_student_over_historical(uuid, uuid, uuid, uuid, text) is
  'Réconciliation conservatrice : garde la fiche et le student_person de l’année courante quand ils existent, transfère le matricule/identité utile de la fiche historique, sans déplacer finance ni inscription courante.';

commit;
