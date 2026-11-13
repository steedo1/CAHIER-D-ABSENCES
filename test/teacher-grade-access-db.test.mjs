import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("grade RLS follows authenticated ownership, canonical subjects, assignment dates and the current year", async () => {
  const db = new PGlite();
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [school, teacher, another, current, historical, math, civic, localMath, localCivic, staff] =
    Array.from({ length: 10 }, (_, index) => id(index + 1));
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select current_setting('request.jwt.claim.sub', true)::uuid $$;
      create table user_roles (profile_id uuid, institution_id uuid, role text);
      create table classes (id uuid, institution_id uuid, academic_year text);
      create table academic_years (institution_id uuid, code text, is_current bool);
      create table institution_subjects (id uuid, institution_id uuid, subject_id uuid, is_active bool);
      create table class_teachers (class_id uuid, teacher_id uuid, institution_id uuid, subject_id uuid, start_date date, end_date date);
      create table grade_evaluations (id integer, class_id uuid, teacher_id uuid, subject_id uuid);
      create table student_grades (evaluation_id integer, score integer);
      create table grade_adjustments (class_id uuid, subject_id uuid);
      create table grade_published_scores (evaluation_id integer);
      create table grade_evaluation_locks (evaluation_id integer);
      create view grade_flat_marks as select * from student_grades;
      create view class_student_subject_avgs as select * from grade_flat_marks;
      create view v_grade_scores_official_for_reports as select * from grade_published_scores;
      grant all on all tables in schema public to anon, authenticated, service_role;
      alter table class_teachers enable row level security;
      alter table grade_evaluations enable row level security;
      alter table student_grades enable row level security;
      alter table grade_adjustments enable row level security;
      create policy class_teachers_read on class_teachers using (true);
      create policy emergency_open_read_class_teachers on class_teachers using (true);
      insert into user_roles values ('${teacher}','${school}','teacher'), ('${another}','${school}','teacher'), ('${staff}','${school}','admin');
      insert into classes values ('${current}','${school}','current'), ('${historical}','${school}','historical');
      insert into academic_years values ('${school}','current',true), ('${school}','historical',false);
      insert into institution_subjects values ('${localMath}','${school}','${math}',true), ('${localCivic}','${school}','${civic}',true);
      insert into class_teachers values
        ('${current}','${teacher}','${school}','${localMath}',current_date-1,null),
        ('${current}','${teacher}','${school}','${localCivic}',current_date-1,current_date),
        ('${historical}','${teacher}','${school}','${localMath}',current_date-100,null),
        ('${current}','${another}','${school}','${localMath}',current_date-1,null);
      insert into grade_evaluations values (1,'${current}','${teacher}','${math}'),
        (2,'${current}','${teacher}','${civic}'), (3,'${current}','${another}','${math}'),
        (4,'${historical}','${teacher}','${math}');
      insert into student_grades values (1, 14), (2, 15), (3, 16), (4, 17);
    `);
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20261113095006_scope_teacher_grade_access.sql", import.meta.url), "utf8"));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${teacher}'`);
    assert.deepEqual((await db.query("select id from grade_evaluations")).rows, [{ id: 1 }]);
    assert.deepEqual((await db.query("select score from student_grades")).rows, [{ score: 14 }]);
    await assert.rejects(db.query("update student_grades set score = 20"), /permission denied/);
    await assert.rejects(db.query("select * from grade_flat_marks"), /permission denied/);
    await assert.rejects(db.query("update user_roles set role = 'admin'"), /permission denied/);
    await assert.rejects(db.query("update academic_years set is_current = true"), /permission denied/);
    assert.equal((await db.query("select count(*)::int as count from class_teachers")).rows[0].count, 3);
    await db.exec(`set request.jwt.claim.sub = '${staff}'`);
    assert.equal((await db.query("select count(*)::int as count from student_grades")).rows[0].count, 4);
    await db.exec("reset role; update class_teachers set end_date = current_date where teacher_id = '" + teacher + "' and class_id = '" + current + "'");
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${teacher}'`);
    assert.deepEqual((await db.query("select id from grade_evaluations")).rows, []);
    await db.exec("set role anon");
    assert.deepEqual((await db.query("select * from class_teachers")).rows, []);
    assert.deepEqual((await db.query("select * from student_grades")).rows, []);
  } finally {
    await db.close();
  }
});
