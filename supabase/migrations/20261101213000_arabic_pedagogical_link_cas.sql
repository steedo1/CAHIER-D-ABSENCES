-- Perform all Arabic pedagogical link updates atomically, without placing
-- the full 30+KB school settings JSON into a URL query parameter.
-- SECURITY INVOKER: the server's service_role client is the only allowed caller.
create or replace function public.cas_school_student_programs_v1(
  p_institution_id uuid,
  p_previous jsonb,
  p_next jsonb
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Deny invocations outside the trusted server role even if privileges drift.
  if current_user <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_next) <> 'object' or p_next->>'version' <> '1'
    or jsonb_typeof(p_next->'years') <> 'object' then
    raise exception 'Invalid pedagogical program document' using errcode = '22023';
  end if;
  update public.institutions
    set settings_json = jsonb_set(settings_json, '{school_student_programs_v1}', p_next, true)
  where id = p_institution_id
    and coalesce(settings_json->'school_student_programs_v1', 'null'::jsonb)
      = coalesce(p_previous, 'null'::jsonb);
  return found;
end;
$$;
revoke all on function public.cas_school_student_programs_v1(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.cas_school_student_programs_v1(uuid,jsonb,jsonb) to service_role;
