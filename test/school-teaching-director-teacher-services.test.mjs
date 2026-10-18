import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const route = "src/app/api/direction-enseignement/teacher-services/route.ts";
const url = "https://fixture.invalid/api/direction-enseignement/teacher-services";
const director = "11111111-1111-4111-8111-111111111111";
const teacher = "22222222-2222-4222-8222-222222222222";
const arabicClass = "33333333-3333-4333-8333-333333333333";
const frenchClass = "44444444-4444-4444-8444-444444444444";
const arabicSubject = "55555555-5555-4555-8555-555555555555";
const frenchSubject = "66666666-6666-4666-8666-666666666666";
const arabicInst = "77777777-7777-4777-8777-777777777777";
const frenchInst = "88888888-8888-4888-8888-888888888888";
const year="2026-2027";
function make(method,classId,body) {
  return new NextRequest(method==="GET" ? url+"?class_id="+classId : url,{
    method,headers:{"content-type":"application/json",origin:"https://fixture.invalid"},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
}
function setup() {
  const db=createMulticycleFixture();
  const settings=db.tables.institutions[0].settings_json;
  settings.school_cycles_v1={
    version:1,enabled:true,enabledCycles:["primary"],
    classCycleById:{[arabicClass]:"primary",[frenchClass]:"primary"},
    teachingTracksByCycle:{primary:["arabic","french"]},
    subjectTracksByCycle:{primary:{[arabicSubject]:["arabic"],[frenchSubject]:["french"]}},
  };
  settings.school_student_programs_v1={
    version:1,years:{[year]:{classes:{
      [arabicClass]:{tracks:["arabic"],students:{}},
      [frenchClass]:{tracks:["french"],students:{}},
    }}},
  };
  settings.school_class_subjects_v1={
    version:1,years:{[year]:{classes:{[arabicClass]:[arabicSubject],[frenchClass]:[frenchSubject]}}},
  };
  db.tables.profiles.push(
    {id:director,institution_id:db.legacyId,display_name:"Direction arabe"},
    {id:teacher,institution_id:db.legacyId,display_name:"Professeur arabe"},
  );
  db.tables.user_roles.push(
    {profile_id:director,institution_id:db.legacyId,role:"teacher"},
    {profile_id:director,institution_id:db.legacyId,role:"teaching_director"},
    {profile_id:teacher,institution_id:db.legacyId,role:"teacher"},
  );
  db.tables.school_teaching_directors=[
    {profile_id:director,institution_id:db.legacyId,teaching_track:"arabic",is_active:true},
  ];
  db.tables.academic_years.push({institution_id:db.legacyId,code:year,is_current:true});
  db.tables.classes.push(
    {id:arabicClass,institution_id:db.legacyId,academic_year:year,level:"CP1",label:"CP1 arabe"},
    {id:frenchClass,institution_id:db.legacyId,academic_year:year,level:"CP1",label:"CP1 français"},
  );
  db.tables.institution_subjects.push(
    {id:arabicInst,institution_id:db.legacyId,subject_id:arabicSubject,is_active:true},
    {id:frenchInst,institution_id:db.legacyId,subject_id:frenchSubject,is_active:true},
  );
  db.tables.subjects.push(
    {id:arabicSubject,name:"Hadith"},{id:frenchSubject,name:"Français"},
  );
  db.tables.teacher_subjects=[
    {profile_id:teacher,subject_id:arabicSubject,institution_id:db.legacyId},
  ];
  db.users.set(director,{user:db.user(director,"director.ar@example.invalid"),password:"fixture"});
  return db;
}

test("teacher service manager only lists the director's allowed class and subject",async()=>{
  const db=setup();
  const api=createFixtureRouteLoader(db,director)(route);
  const own=await api.GET(make("GET",arabicClass));
  assert.equal(own.status,200,JSON.stringify(await own.clone().json()));
  const data=await own.json();
  assert.deepEqual(data.subjects.map(x=>x.id),[arabicInst]);
  assert.deepEqual(data.candidates.map(x=>x.teacherId),[teacher]);
  const forbidden=await api.GET(make("GET",frenchClass));
  assert.equal(forbidden.status,403);
  assert.equal(db.calls.some(x=>x.op!=="read"),false);
});

test("director can only assign an eligible teacher to their own class and subject",async()=>{
  const db=setup();
  const api=createFixtureRouteLoader(db,director)(route);
  const no=await api.POST(make("POST",null,{
    classId:frenchClass,teacherId:teacher,institutionSubjectId:frenchInst,
  }));
  assert.equal(no.status,403);
  const wrong=await api.POST(make("POST",null,{
    classId:arabicClass,teacherId:teacher,institutionSubjectId:frenchInst,
  }));
  assert.equal(wrong.status,403);
  assert.equal(db.tables.class_teachers.length,0);
  const saved=await api.POST(make("POST",null,{
    classId:arabicClass,teacherId:teacher,institutionSubjectId:arabicInst,
  }));
  assert.equal(saved.status,201,JSON.stringify(await saved.clone().json()));
  const assigned=await saved.json();
  assert.equal(db.tables.class_teachers.length,1);
  assert.equal(db.tables.class_teachers[0].subject_id,arabicInst);
  const duplicate=await api.POST(make("POST",null,{
    classId:arabicClass,teacherId:teacher,institutionSubjectId:arabicInst,
  }));
  assert.equal(duplicate.status,409);
  const close=await api.PATCH(make("PATCH",null,{
    classId:arabicClass,assignmentId:assigned.id,
  }));
  assert.equal(close.status,200,JSON.stringify(await close.clone().json()));
  assert.ok(db.tables.class_teachers[0].end_date);
  assert.equal(db.calls.some(x=>x.op!=="read"&&x.table!=="class_teachers"),false);
});

test("classic account can never enter director teacher-services management",async()=>{
  const db=setup();
  const denied=await createFixtureRouteLoader(db,db.legacyAdminId)(route)
    .GET(make("GET",arabicClass));
  assert.equal(denied.status,403);
  assert.equal(db.calls.some(x=>x.op!=="read"),false);
});
