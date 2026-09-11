alter table public.students
  add column if not exists parent_names text,
  add column if not exists parent_contact text;

comment on column public.students.parent_names is
  'Nom(s) des parents ou tuteurs. Champ facultatif utilisé sur les attestations de fréquentation.';
comment on column public.students.parent_contact is
  'Téléphone, WhatsApp ou autre contact du parent/tuteur. Champ facultatif.';

drop policy if exists students_read on public.students;
create policy students_read on public.students
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = students.institution_id
      and ur.role in ('admin', 'educator', 'teacher', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists students_write_file_correspondent on public.students;
create policy students_write_file_correspondent on public.students
for all to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = students.institution_id
      and ur.role = 'file_correspondent'
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = students.institution_id
      and ur.role = 'file_correspondent'
  )
);

drop policy if exists enrollments_read on public.class_enrollments;
create policy enrollments_read on public.class_enrollments
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = class_enrollments.institution_id
      and ur.role in ('admin', 'educator', 'teacher', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists enrollments_write_file_correspondent on public.class_enrollments;
create policy enrollments_write_file_correspondent on public.class_enrollments
for all to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = class_enrollments.institution_id
      and ur.role = 'file_correspondent'
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = class_enrollments.institution_id
      and ur.role = 'file_correspondent'
  )
);

drop policy if exists class_teachers_read on public.class_teachers;
create policy class_teachers_read on public.class_teachers
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = class_teachers.institution_id
      and ur.role in ('admin', 'educator', 'teacher', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists class_teachers_write_file_correspondent on public.class_teachers;
create policy class_teachers_write_file_correspondent on public.class_teachers
for all to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = class_teachers.institution_id
      and ur.role = 'file_correspondent'
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = class_teachers.institution_id
      and ur.role = 'file_correspondent'
  )
);

drop policy if exists classes_read on public.classes;
create policy classes_read on public.classes
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = classes.institution_id
      and ur.role in ('admin', 'educator', 'teacher', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists classes_select_staff on public.classes;
create policy classes_select_staff on public.classes
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = classes.institution_id
      and ur.role in ('admin', 'educator', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists classes_write_staff on public.classes;
create policy classes_write_staff on public.classes
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = classes.institution_id
      and ur.role in ('admin', 'educator', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists classes_write_file_correspondent on public.classes;
create policy classes_write_file_correspondent on public.classes
for all to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = classes.institution_id
      and ur.role = 'file_correspondent'
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = classes.institution_id
      and ur.role = 'file_correspondent'
  )
);

drop policy if exists inst_subjects_read on public.institution_subjects;
create policy inst_subjects_read on public.institution_subjects
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = institution_subjects.institution_id
      and ur.role in ('admin', 'educator', 'teacher', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists inst_subjects_write_file_correspondent on public.institution_subjects;
create policy inst_subjects_write_file_correspondent on public.institution_subjects
for all to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = institution_subjects.institution_id
      and ur.role = 'file_correspondent'
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = institution_subjects.institution_id
      and ur.role = 'file_correspondent'
  )
);

drop policy if exists guardians_write_file_correspondent on public.student_guardians;
create policy guardians_write_file_correspondent on public.student_guardians
for all to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = student_guardians.institution_id
      and ur.role = 'file_correspondent'
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = student_guardians.institution_id
      and ur.role = 'file_correspondent'
  )
);

drop policy if exists ts_select_admins on public.teacher_subjects;
create policy ts_select_admins on public.teacher_subjects
for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = teacher_subjects.institution_id
      and ur.role in ('admin', 'educator', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists ts_insert_admins on public.teacher_subjects;
create policy ts_insert_admins on public.teacher_subjects
for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = teacher_subjects.institution_id
      and ur.role in ('admin', 'educator', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists ts_update_admins on public.teacher_subjects;
create policy ts_update_admins on public.teacher_subjects
for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = teacher_subjects.institution_id
      and ur.role in ('admin', 'educator', 'super_admin', 'file_correspondent')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = teacher_subjects.institution_id
      and ur.role in ('admin', 'educator', 'super_admin', 'file_correspondent')
  )
);

drop policy if exists ts_delete_admins on public.teacher_subjects;
create policy ts_delete_admins on public.teacher_subjects
for delete to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.profile_id = auth.uid()
      and ur.institution_id = teacher_subjects.institution_id
      and ur.role in ('admin', 'educator', 'super_admin', 'file_correspondent')
  )
);
