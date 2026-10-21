import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { schoolSettingsRevision } from "../src/lib/school-settings-write.ts";

function previewRequest(origin="https://www.mon-cahier.com") {
  return new NextRequest("http://localhost:10000/api/admin/grades/bulletin",{
    method:"POST",headers:{origin,"content-type":"application/json"},
    body:JSON.stringify({action:"prepare_preview_qr",tokens:[]}),
  });
}
const bulletinRoute="src/app/api/admin/grades/bulletin/route.ts";
test("QR sur Render : le domaine officiel atteint l'authentification, puis la validation des tokens",async()=>{
  const db=createMulticycleFixture();
  const unauth=await createFixtureRouteLoader(db,null)(bulletinRoute).POST(previewRequest());
  assert.equal(unauth.status,401);assert.equal((await unauth.json()).error,"UNAUTHENTICATED");
  const authed=await createFixtureRouteLoader(db,db.legacyAdminId)(bulletinRoute).POST(previewRequest());
  assert.equal(authed.status,400);assert.equal((await authed.json()).error,"INVALID_PREVIEW_QR_REQUEST");
  assert.equal(db.calls.some(call=>call.op!=="read"),false);
});
test("QR sur Render : un site étranger est rejeté avant tout accès aux données",async()=>{
  const db=createMulticycleFixture();
  const response=await createFixtureRouteLoader(db,db.legacyAdminId)(bulletinRoute).POST(previewRequest("https://evil.invalid"));
  assert.equal(response.status,403);assert.equal((await response.json()).error,"FORBIDDEN_ORIGIN");
  assert.equal(db.calls.length,0);
});
test("modèle de bulletin derrière le proxy : garde de rôle intacte et modification limitée à la présentation",async()=>{
  const db=createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1={version:1,enabled:true,enabledCycles:["primary","secondary"],
    teachingTracksByCycle:{primary:["french","arabic"],secondary:["french","arabic"]},subjectTracksByCycle:{},classCycleById:{},defaultView:"all"};
  db.tables.institutions[0].settings_json.franco_arabic_reports_v1={version:1,enabled:true,engine:"specialized",
    coefficientSource:"institution",format:"separate",scales:[{cycle:"primary",level:"CP1",track:"french",maxScore:10}],coefficients:[]};
  const before=structuredClone(db.tables.institutions[0].settings_json);
  const request=()=>new NextRequest("http://localhost:10000/api/admin/bulletin-model-selection",{
    method:"PATCH",headers:{origin:"https://www.mon-cahier.com","content-type":"application/json"},
    body:JSON.stringify({cycle:"primary",format:"combined",revision:schoolSettingsRevision(before)}),
  });
  const path="src/app/api/admin/bulletin-model-selection/route.ts";
  assert.equal((await createFixtureRouteLoader(db,null)(path).PATCH(request())).status,401);
  assert.equal((await createFixtureRouteLoader(db,db.superId)(path).PATCH(request())).status,403);
  const response=await createFixtureRouteLoader(db,db.legacyAdminId)(path).PATCH(request());
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const saved=db.tables.institutions[0].settings_json;
  assert.equal(saved.franco_arabic_reports_v1.formatsByCycle.primary,"combined");
  for(const key of ["engine","scales","coefficients"])assert.deepEqual(saved.franco_arabic_reports_v1[key],before.franco_arabic_reports_v1[key]);
  assert.equal(db.calls.some(call=>call.op!=="read"&&call.table!=="institutions"),false);
});
