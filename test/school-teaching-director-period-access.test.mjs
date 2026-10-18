import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createFixtureRouteLoader, createMulticycleFixture } from "./helpers/multicycle-fixture.mjs";

const route="src/app/api/admin/school-grading-periods/route.ts";
const url="https://fixture.invalid/api/admin/school-grading-periods";
const DIRECTOR="11111111-1111-4111-8111-111111111111";
const year="2026-2027";

function fixture() {
  const db=createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1={
    version:1,enabled:true,enabledCycles:["primary","secondary"],
    classCycleById:{},subjectTracksByCycle:{},
    teachingTracksByCycle:{primary:["french","arabic"],secondary:["french","arabic"]},
  };
  db.tables.profiles.push({ id:DIRECTOR,institution_id:db.legacyId });
  db.tables.user_roles.push(
    {profile_id:DIRECTOR,institution_id:db.legacyId,role:"teacher"},
    {profile_id:DIRECTOR,institution_id:db.legacyId,role:"teaching_director"},
  );
  db.tables.school_teaching_directors=[
    {institution_id:db.legacyId,profile_id:DIRECTOR,teaching_track:"arabic",is_active:true},
  ];
  db.tables.grade_periods=[];
  db.users.set(DIRECTOR,{user:db.user(DIRECTOR,"director@example.invalid"),password:"fixtureonly"});
  return db;
}
const get=(track)=>new NextRequest(
  `${url}?academic_year=${year}&cycle=primary&track=${track}`,{method:"GET"});
const put=(track)=>new NextRequest(url,{
  method:"PUT", headers:{"content-type":"application/json","origin":"https://fixture.invalid"},
  body:JSON.stringify({academic_year:year,cycle:"primary",track,periods:[{
    code:"JUIN",label:"Composition de juin",short_label:"Composition de juin",
    start_date:"2027-06-01",end_date:"2027-06-30",is_active:true,coeff:1,
  }]}),
});

test("director can read and edit only Arabic primary grading periods",async()=>{
  const db=fixture();
  const api=createFixtureRouteLoader(db,DIRECTOR)(route);
  const own=await api.GET(get("arabic"));
  assert.equal(own.status,200,JSON.stringify(await own.clone().json()));
  const blocked=await api.GET(get("french"));
  assert.equal(blocked.status,403);
  const blockedSave=await api.PUT(put("french"));
  assert.equal(blockedSave.status,403);
  assert.equal(db.tables.grade_periods.length,0);
  const saved=await api.PUT(put("arabic"));
  assert.equal(saved.status,200,JSON.stringify(await saved.clone().json()));
  assert.equal(db.tables.grade_periods.length,1);
  assert.equal(db.tables.grade_periods[0].formation_code,"SCHOOL_PROGRAM_PRIMARY_ARABIC");
  assert.equal(db.tables.grade_periods[0].label,"Composition de juin");
  assert.equal(db.calls.some(c=>c.op!=="read" && c.table!=="grade_periods"),false);
});

test("classic school period API grants and denials remain unchanged",async()=>{
  const classic=createMulticycleFixture();
  const response=await createFixtureRouteLoader(classic,classic.legacyAdminId)(route)
    .GET(get("french"));
  assert.equal(response.status,404);
  assert.equal(classic.calls.some(c=>c.op!=="read"),false);
});
