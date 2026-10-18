import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const route = "src/app/api/admin/school-class-subjects/route.ts";
const url = "https://example.invalid/api/admin/school-class-subjects";
const director = "11111111-1111-4111-8111-111111111111";
const frenchClass = "22222222-2222-4222-8222-222222222222";
const arabicClass = "33333333-3333-4333-8333-333333333333";
const frenchSubject = "44444444-4444-4444-8444-444444444444";
const arabicSubject = "55555555-5555-4555-8555-555555555555";
const year = "2026-2027";
const req = (path, method="GET", body) => new NextRequest(path, {
  method,headers: {origin:"https://example.invalid","content-type":"application/json"},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
});
function setup() {
  const db=createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1={
    version:1,enabled:true,enabledCycles:["primary"],
    classCycleById:{[frenchClass]:"primary",[arabicClass]:"primary"},
    teachingTracksByCycle:{primary:["french","arabic"]},
    subjectTracksByCycle:{primary:{[frenchSubject]:["french"],[arabicSubject]:["arabic"]}},
  };
  db.tables.institutions[0].settings_json.school_student_programs_v1={
    version:1,years:{[year]:{classes:{
      [frenchClass]:{tracks:["french"],students:{}},
      [arabicClass]:{tracks:["arabic"],students:{}},
    }}},
  };
  db.tables.profiles.push({id:director,institution_id:db.legacyId});
  db.tables.user_roles.push(
    {profile_id:director,institution_id:db.legacyId,role:"teacher"},
    {profile_id:director,institution_id:db.legacyId,role:"teaching_director"},
  );
  db.tables.school_teaching_directors=[{
    profile_id:director,institution_id:db.legacyId,teaching_track:"arabic",is_active:true,
  }];
  db.tables.academic_years.push({id:"year-current",institution_id:db.legacyId,
    code:year,is_current:true,start_date:"2026-09-01"});
  db.tables.classes.push(
    {id:frenchClass,institution_id:db.legacyId,academic_year:year,label:"CP1 français",level:"CP1"},
    {id:arabicClass,institution_id:db.legacyId,academic_year:year,label:"CP1 arabe",level:"CP1"},
  );
  db.tables.institution_subjects.push(
    {id:"fr-inst",institution_id:db.legacyId,subject_id:frenchSubject,is_active:true},
    {id:"ar-inst",institution_id:db.legacyId,subject_id:arabicSubject,is_active:true},
  );
  db.tables.subjects.push(
    {id:frenchSubject,name:"Mathématiques"}, {id:arabicSubject,name:"Arabe"},
  );
  db.users.set(director,{user:db.user(director,"arabic.director@example.invalid"),password:"fixtureonly"});
  return db;
}
test("director cannot see or edit the other teaching's class subjects",async()=>{
  const db=setup();
  const api=createFixtureRouteLoader(db,director)(route);
  const start=await api.GET(req(url));
  assert.equal(start.status,200,JSON.stringify(await start.clone().json()));
  const listing=await start.json();
  assert.deepEqual(listing.classes.map(x=>x.id),[arabicClass]);
  const forbidden=await api.GET(req(url+"?class_id="+frenchClass));
  assert.equal(forbidden.status,403);
  const denied=await api.PUT(req(url,"PUT",{
    revision:listing.revision,classId:frenchClass,subjectIds:[frenchSubject],
  }));
  assert.equal(denied.status,403);
  assert.equal(db.calls.some(c=>c.op!=="read"),false);
  const selected=await api.GET(req(url+"?class_id="+arabicClass));
  assert.equal(selected.status,200);
  assert.deepEqual((await selected.json()).subjects.map(x=>x.id),[arabicSubject]);
  const wrong=await api.PUT(req(url,"PUT",{
    revision:listing.revision,classId:arabicClass,subjectIds:[frenchSubject],
  }));
  assert.equal(wrong.status,400);
  const saved=await api.PUT(req(url,"PUT",{
    revision:listing.revision,classId:arabicClass,subjectIds:[arabicSubject],
  }));
  assert.equal(saved.status,200,JSON.stringify(await saved.clone().json()));
  assert.deepEqual(db.tables.institutions[0].settings_json.school_class_subjects_v1
    .years[year].classes[arabicClass],[arabicSubject]);
  assert.equal(db.tables.institutions[0].settings_json.school_class_subjects_v1
    .years[year].classes[frenchClass],undefined);
});
test("classic admins retain their existing classes API",async()=>{
  const db=createMulticycleFixture();
  assert.equal((await createFixtureRouteLoader(db,db.legacyAdminId)(route)
    .GET(req(url))).status,404);
  assert.equal(db.calls.some(c=>c.op!=="read"),false);
});
