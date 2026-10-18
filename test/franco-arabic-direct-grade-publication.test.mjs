import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { readFileSync } from "node:fs";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const urls = {
  settings: "https://fixture.invalid/api/admin/grades/publication-settings",
  requests: "https://fixture.invalid/api/admin/grades/publication-requests",
};
const settingsRoute = "src/app/api/admin/grades/publication-settings/route.ts";
const approvalRoute = "src/app/api/admin/grades/publication-requests/route.ts";
const settings = {
  require_admin_validation: true, auto_push_on_publish: false,
  sms_digest_mode: "disabled",
};
function fixture(special = true) {
  const db = createMulticycleFixture();
  if (special) {
    db.tables.institutions[0].settings_json.school_cycles_v1 = {
      version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
      classCycleById: {}, subjectTracksByCycle: {},
      teachingTracksByCycle: {
        primary: ["french", "arabic"], secondary: ["french", "arabic"],
      },
    };
  }
  db.tables.institution_grade_publication_settings = [{
    institution_id: db.legacyId, ...settings,
  }];
  return db;
}
const get = url => new NextRequest(url);
const post = (url, body) => new NextRequest(url, {
  method: "POST", headers: { "Content-Type": "application/json",
    origin: "https://fixture.invalid" },
  body: JSON.stringify(body),
});

test("Franco-Arabic teacher publishing overrides historical admin approval and push preferences", async () => {
  const db=fixture(true);
  const policy=createFixtureRouteLoader(db,db.legacyAdminId)
    ("src/lib/grades/publication.ts");
  const result=await policy.getGradePublicationSettings(db.legacyId);
  assert.equal(result.require_admin_validation,false);
  assert.equal(result.auto_push_on_publish,true);
  assert.equal(result.sms_digest_mode,"disabled",
    "SMS credit and digest options are not implicitly enabled");
  assert.deepEqual(db.tables.institution_grade_publication_settings[0].require_admin_validation,true,
    "Historical policy row is preserved, not forcibly migrated");
  assert.equal(db.calls.some(x=>x.op!=="read"),false);
});

test("classic schools keep their existing approval and push preferences", async () => {
  const db=fixture(false);
  const policy=createFixtureRouteLoader(db,db.legacyAdminId)
    ("src/lib/grades/publication.ts");
  const result=await policy.getGradePublicationSettings(db.legacyId);
  assert.equal(result.require_admin_validation,true);
  assert.equal(result.auto_push_on_publish,false);
});

test("old admin settings and publication approval APIs are disabled only for Franco-Arabic schools", async () => {
  const db=fixture(true);
  const loader=createFixtureRouteLoader(db,db.legacyAdminId);
  const config=loader(settingsRoute);
  const approvals=loader(approvalRoute);
  const responses=[
    await config.GET(),
    await config.POST(post(urls.settings,{
      require_admin_validation:true,auto_push_on_publish:false,
    })),
    await approvals.GET(get(urls.requests)),
    await approvals.POST(post(urls.requests,{
      evaluation_id:"11111111-1111-4111-8111-111111111111",action:"approve",
    })),
  ];
  for(const res of responses){
    assert.equal(res.status,404,JSON.stringify(await res.clone().json()));
  }
  assert.equal(db.calls.some(x=>x.op!=="read"),false,
    "No admin approval or settings mutations are possible");
});

test("classic-school publication settings API still permits its original GET and POST", async () => {
  const db=fixture(false);
  const api=createFixtureRouteLoader(db,db.legacyAdminId)(settingsRoute);
  const before=await api.GET();
  assert.equal(before.status,200,JSON.stringify(await before.clone().json()));
  assert.equal((await before.json()).item.require_admin_validation,true);
  const changed=await api.POST(post(urls.settings,{
    require_admin_validation:false,auto_push_on_publish:true,
  }));
  assert.equal(changed.status,200,JSON.stringify(await changed.clone().json()));
  assert.equal((await changed.json()).item.auto_push_on_publish,true);
});

test("no legacy grade approval screens or polling remain for Franco-Arabic admins", () => {
  const nav=readFileSync("src/app/admin/ui/sidebar-nav.tsx","utf8");
  const policy=readFileSync("src/lib/grades/publication.ts","utf8");
  const guard=readFileSync("src/components/admin/ClassicGradePublicationOnly.tsx","utf8");
  const teacher=readFileSync("src/app/grades/page.tsx","utf8");
  assert.match(nav,/directSchoolGradePublication/);
  assert.match(nav,/item\.href === "\/admin\/notes\/publication-requests"/);
  assert.match(nav,/item\.href === "\/admin\/notes\/publication-settings"/);
  assert.match(guard,/redirect\("\/admin\/notes"\)/);
  assert.match(policy,/effectiveGradePublicationSwitches/);
  assert.match(policy,/queueGradeNotificationsForEvaluation/);
  assert.match(teacher,/Publier les notes/);
  assert.match(teacher,/Notifications des parents mises en file d’envoi/);
});
