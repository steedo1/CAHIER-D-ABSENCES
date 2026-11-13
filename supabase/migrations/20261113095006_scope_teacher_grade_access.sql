-- Teacher grade access uses the official active class/discipline assignment.
-- Historical assignments and all pupil data are retained.
create or replace function public.is_teacher_for_class_subject(cid uuid, sid uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.class_teachers ct
    join public.classes c on c.id = ct.class_id and c.institution_id = ct.institution_id
    join public.academic_years y on y.institution_id = c.institution_id
      and y.code = c.academic_year and y.is_current
    join public.institution_subjects ins on ins.id = ct.subject_id
      and ins.institution_id = ct.institution_id and ins.is_active
    join public.user_roles ur on ur.profile_id = ct.teacher_id
      and ur.institution_id = ct.institution_id and ur.role = 'teacher'
    where ct.class_id = cid and ins.subject_id = sid and ct.teacher_id = (select auth.uid())
      and ct.start_date <= current_date and (ct.end_date is null or ct.end_date > current_date)
  );
$$;

create function public.is_grade_staff_for_class(cid uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.classes c
    join public.user_roles ur on ur.institution_id = c.institution_id
    where c.id = cid and ur.profile_id = (select auth.uid())
      and ur.role in ('super_admin', 'admin', 'educator')
  );
$$;

revoke execute on function public.is_grade_staff_for_class(uuid) from public, anon;
grant execute on function public.is_grade_staff_for_class(uuid) to authenticated, service_role;

drop policy if exists ge_select on public.grade_evaluations;
drop policy if exists ge_insert on public.grade_evaluations;
drop policy if exists ge_update on public.grade_evaluations;
drop policy if exists grade_evals_rw on public.grade_evaluations;
drop policy if exists grade_evals_sel on public.grade_evaluations;

create policy grade_evaluations_staff on public.grade_evaluations
  for all to authenticated
  using (public.is_grade_staff_for_class(class_id))
  with check (public.is_grade_staff_for_class(class_id));

create policy grade_evaluations_teacher_read on public.grade_evaluations
  for select to authenticated using (
    teacher_id = (select auth.uid()) and public.is_teacher_for_class_subject(class_id, subject_id)
  );

drop policy if exists sg_select on public.student_grades;
drop policy if exists sg_upsert on public.student_grades;
drop policy if exists student_grades_admin_sel on public.student_grades;
drop policy if exists student_grades_rw on public.student_grades;
drop policy if exists student_grades_sel on public.student_grades;

create policy student_grades_scoped_read on public.student_grades
  for select to authenticated using (
    exists (select 1 from public.grade_evaluations ge where ge.id = evaluation_id)
  );

drop policy if exists ga_rw on public.grade_adjustments;
create policy grade_adjustments_scoped_read on public.grade_adjustments
  for select to authenticated using (
    public.is_grade_staff_for_class(class_id) or public.is_teacher_for_class_subject(class_id, subject_id)
  );

-- Writes go through the application, which checks pupils, locks and publication rules.
revoke insert, update, delete, truncate, trigger on
  public.grade_evaluations, public.student_grades, public.grade_adjustments,
  public.grade_published_scores, public.grade_evaluation_locks
  from anon, authenticated;
revoke select on
  public.grade_evaluation_locks, public.grade_flat_marks, public.class_student_subject_avgs,
  public.v_grade_scores_official_for_reports
  from anon, authenticated;

-- Keep the inputs of assignment and role checks writable only by the server.
revoke insert, update, delete, truncate, trigger on public.user_roles, public.academic_years
  from anon, authenticated;

drop policy if exists emergency_open_read_class_teachers on public.class_teachers;
alter policy class_teachers_read on public.class_teachers to authenticated using (
  teacher_id = (select auth.uid())
  or exists (
    select 1 from public.user_roles ur
    where ur.profile_id = (select auth.uid()) and ur.institution_id = class_teachers.institution_id
      and ur.role in ('super_admin', 'admin', 'educator', 'file_correspondent')
  )
);

-- This legacy SECURITY DEFINER reader predates the scoped admin routes.
do $$
begin
  if to_regprocedure('public.admin_recent_grade_evaluations(integer)') is not null then
    revoke execute on function public.admin_recent_grade_evaluations(integer) from public, anon, authenticated;
    grant execute on function public.admin_recent_grade_evaluations(integer) to service_role;
  end if;
end
$$;
