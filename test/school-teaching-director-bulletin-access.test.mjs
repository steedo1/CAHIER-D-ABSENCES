import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const route="src/app/api/direction-enseignement/bulletins/route.ts";
const direct="11111111-1111-4111-8111-111111111111";
const arabic="22222222-2222-4222-8222-222222222222";
const french="33333333-3333-4333-8333-333333333333";
const period="44444444-4444-4444-8444-444444444444";
const year="2026-2027";
const url="https://fixture.invalid/api/direction-enseignement/bulletins";
const get=id=>new NextRequest(`${url}?class_id=${id}&period_id=${period}`);

function setup() {
  const db=createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1={
    version:1,enabled:true,enabledCycles:["primary"],classCycleById:{[arabic]:"primary",[french]:"primary"},
    teachingTracksByCycle:{primary:["arabic","french"]},subjectTracksByCycle:{primary:{}},
  };
  db.tables.institutions[0].settings_json.school_student_programs_v1={
    version:1,years:{[year]:{classes:{
      [arabic]:{tracks:["arabic"],students:{}},[french]:{tracks:["french"],students:{}},
    }}},
  };
  db.tables.profiles.push({id:direct,institution_id:db.legacyId});
  db.tables.user_roles.push(
    {profile_id:direct,institution_id:db.legacyId,role:"teacher"},
    {profile_id:direct,institution_id:db.legacyId,role:"teaching_director"},
  );
  db.tables.school_teaching_directors=[
    {profile_id:direct,institution_id:db.legacyId,teaching_track:"arabic",is_active:true},
  ];
  db.tables.classes=[
    {id:arabic,institution_id:db.legacyId,academic_year:year,level:"CP1",label:"CP1 arabe"},
    {id:french,institution_id:db.legacyId,academic_year:year,level:"CP1",label:"CP1 français"},
  ];
  db.tables.academic_years=[{institution_id:db.legacyId,code:year,is_current:true}];
  db.users.set(direct,{user:db.user(direct,"arabic@example.invalid"),password:"demo"});
  return db;
}

test("the Arabic director is denied a French bulletin before grade data are queried",async()=>{
  const db=setup();
  const routeModule=createFixtureRouteLoader(db,direct)(route);
  const denied=await routeModule.GET(get(french));
  assert.equal(denied.status,403,JSON.stringify(await denied.clone().json()));
  assert.equal(db.calls.some(row=>row.table==="grade_evaluations"||
    row.table==="grade_published_scores"||row.table==="class_enrollments"),false);
  const own=await routeModule.GET(get(arabic));
  // Authorized class reaches the specialized-engine check, which is intentionally
  // disabled in this fixture. It must not fall back to an admin-wide bulletin.
  assert.equal(own.status,409,JSON.stringify(await own.clone().json()));
  const body=await own.json();
  assert.equal(body.error,"specialized_bulletins_not_enabled");
});
test("ordinary admin is not automatically a teaching director",async()=>{
  const db=setup();
  const denied=await createFixtureRouteLoader(db,db.legacyAdminId)(route).GET(get(arabic));
  assert.equal(denied.status,403);
  assert.equal(db.calls.some(x=>x.op!=="read"),false);
});
