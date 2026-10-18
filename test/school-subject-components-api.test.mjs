import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { setupComponents, cFr, cAr, cOther, subject, period } from "./helpers/subject-components-fixture.mjs";

const route = "src/app/api/admin/institution/subject-components/route.ts";
const path = "/api/admin/institution/subject-components";
const req = (url, method="GET", body) => new NextRequest("https://example.invalid" + url, { method,
  headers: { origin: "https://example.invalid", "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}) });
const context = (class_id=cAr, cycle="secondary", level="6e") => ({ class_id, subject_id: subject, cycle,
  track: class_id === cFr ? "french" : "arabic", level });
const get = async (api, ctx=context()) => {
  const response = await api.GET(req(path + "?" + new URLSearchParams(ctx)));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return response.json();
};
const component = (code, weight) => ({ code, label: code, coeff_in_subject: weight });
const save = async (api, ctx, items) => {
  const before = await get(api, ctx);
  const response = await api.PUT(req(path, "PUT", { ...ctx, revision: before.revision, items }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return get(api, ctx);
};

test("common discipline: Arabic create/edit/reload preserves French IDs, weights and other level", async () => {
  const db=setupComponents(), api=createFixtureRouteLoader(db,db.legacyAdminId)(route);
  const fr = await save(api, context(cFr), [component("CF",1),component("EO",2)]);
  const historical = structuredClone(db.tables.grade_subject_components);
  const other = await save(api, context(cOther,"secondary","5e"),[component("other",5)]);
  const first = await save(api, context(), [component("oral",2),component("ecrit",3)]);
  assert.notEqual(first.items[0].id, fr.items[0].id);
  const updated = await save(api,context(),first.items.map((row,index)=>({...row,label:"modifié-"+index,coeff_in_subject:index?4:1})));
  assert.deepEqual(updated.items.map(row=>row.id),first.items.map(row=>row.id));
  assert.deepEqual(db.tables.grade_subject_components.filter(row=>historical.some(old=>old.id===row.id)),historical);
  assert.deepEqual((await get(api,context(cOther,"secondary","5e"))).items,other.items);
  assert.deepEqual((await get(api,context(cFr))).items,fr.items);
  const teacher=createFixtureRouteLoader(db,db.legacyAdminId)("src/app/api/teacher/grades/components/route.ts");
  const loaded=await (await teacher.GET(req(`/api/teacher/grades/components?class_id=${cAr}&subject_id=${subject}`))).json();
  assert.deepEqual(loaded.items.map(row=>row.id),updated.items.map(row=>row.id));
  // Removing a component retains its row/ID for already-linked evaluations.
  await save(api,context(),[{...updated.items[0],coeff_in_subject:5}]);
  assert.equal(db.tables.grade_subject_components.find(row=>row.id===updated.items[1].id).is_active,false);
});

test("server rejects foreign IDs, stale classes/revisions, wrong sums and unauthorized writes",async()=>{
  const db=setupComponents(), api=createFixtureRouteLoader(db,db.legacyAdminId)(route);
  const french=await save(api,context(cFr),[component("french",3)]);
  const before=await get(api), snapshot=structuredClone(db.tables);
  for (const extra of [ { items:[{...french.items[0],coeff_in_subject:5}] }, {track:"french"},
    {level:"5e"}, {revision:"stale"}, {items:[component("bad",1)]}, {class_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"} ]) {
    const response=await api.PUT(req(path,"PUT",{...context(),revision:before.revision,items:[component("ok",5)],...extra}));
    assert.ok(response.status>=400,JSON.stringify(extra));
    assert.deepEqual(db.tables,snapshot);
  }
  assert.equal((await api.PUT(req(path,"PUT",{subject_id:subject,level:"6e",items:[]}))).status,400);
  assert.equal((await createFixtureRouteLoader(db,null)(route).PUT(req(path,"PUT",{}))).status,401);
  const stale=await api.PUT(req(path,"PUT",{...context(),revision:before.revision,items:[component("ok",5)]}));
  assert.equal(stale.status,200);
  assert.equal((await api.PUT(req(path,"PUT",{...context(),revision:before.revision,items:[]}))).status,409);
});

for (const level of ["6e", "2ndeA"]) test(`secondary ${level}: saved Arabic components feed real evaluation API, averages and bulletin`,async()=>{
  const cycle="secondary";
  const db=setupComponents(cycle,level);
  const ctx=context(cAr,cycle,level);
  const load=createFixtureRouteLoader(db,db.legacyAdminId), api=load(route);
  const saved=await save(api,ctx,[component("oral",2),component("ecrit",3)]);
  const evaluations=load("src/app/api/teacher/grades/evaluations/route.ts");
  for (const [index,part] of saved.items.entries()) {
    const created=await evaluations.POST(req("/api/teacher/grades/evaluations","POST",{
      class_id:cAr,subject_id:subject,subject_component_id:part.id,grading_period_id:period,
      eval_date:"2026-10-01",eval_kind:cycle==="primary"?"composition":"devoir",scale:20,coeff:1,
    }));
    assert.equal(created.status,200,JSON.stringify(await created.clone().json()));
    const evaluation=db.tables.grade_evaluations.at(-1);
    Object.assign(evaluation,{is_published:true,publication_status:"published",publication_version:1});
    db.tables.grade_published_scores.push({id:"score-"+index,institution_id:db.legacyId,class_id:cAr,
      student_id:"student-0",evaluation_id:evaluation.id,subject_id:subject,eval_date:"2026-10-01",
      score:index?10:20,scale:20,coeff:1,is_current:true,publication_version:1});
    db.tables.student_grades.push({evaluation_id:evaluation.id,student_id:"student-0",score:index?10:20});
  }
  const bad=await evaluations.POST(req("/api/teacher/grades/evaluations","POST",{
    class_id:cFr,subject_id:subject,subject_component_id:saved.items[0].id,grading_period_id:period,
    eval_date:"2026-10-01",eval_kind:cycle==="primary"?"composition":"devoir",scale:20,coeff:1,
  }));
  assert.equal(bad.status,400,"Arabic component must never be accepted in French class");
  const average=await load("src/app/api/grades/averages/route.ts").GET(req(`/api/grades/averages?class_id=${cAr}&subject_id=${subject}&academic_year=2026-2027&published_only=false`));
  assert.equal(average.status,200,JSON.stringify(await average.clone().json()));
  assert.equal((await average.json()).items[0].average,14);
  const response=await load("src/app/api/admin/grades/bulletin/route.ts").GET(req(`/api/admin/grades/bulletin?class_id=${cAr}&period_id=${period}&from=2026-09-01&to=2026-12-15&academic_year=2026-2027`));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const result=(await response.json()).specialized.documents[0];
  assert.equal(result.document.arabic.generalAverage,14);
  assert.equal(result.document.french,undefined);
  assert.equal(result.document.arabic.subjects[0].components.length,2);
  assert.equal(result.document.arabic.subjects[0].coefficient,cycle==="primary"?null:5);
  assert.equal(result.ready,true,JSON.stringify(result.problems));
  const evaluationIds=db.tables.grade_evaluations.map(row=>row.id);
  await save(api,ctx,saved.items.map((part,index)=>({...part,coeff_in_subject:index?4:1})));
  const recalculated=await load("src/app/api/admin/grades/bulletin/route.ts").GET(req(`/api/admin/grades/bulletin?class_id=${cAr}&period_id=${period}&from=2026-09-01&to=2026-12-15&academic_year=2026-2027`));
  assert.equal((await recalculated.json()).specialized.documents[0].document.arabic.generalAverage,12);
  assert.deepEqual(db.tables.grade_evaluations.map(row=>row.id),evaluationIds,"Editing weights retains evaluation links");
});

for (const cycle of ["primary", "preschool"]) test(`${cycle} remains outside the secondary component editor without a write`,async()=>{
  const db=setupComponents(cycle,cycle==="primary"?"CM2":"GS"), api=createFixtureRouteLoader(db,db.legacyAdminId)(route);
  const response=await api.GET(req(path+"?"+new URLSearchParams(context(cAr,cycle,cycle==="primary"?"CM2":"GS"))));
  assert.equal(response.status,409);
  assert.equal(db.calls.some(call=>call.op!=="read"),false);
});
