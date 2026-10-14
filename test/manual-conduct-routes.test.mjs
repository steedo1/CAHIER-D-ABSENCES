import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureState, loadConductRoutes, classroom, otherClass, student, second } from "./manual-conduct-server.mjs";
const body=(hours=4)=>({class_id:classroom,academic_year:"2026-2027",period_code:"T1",items:[{student_id:student,absence_hours:hours}]});
test("Saisie des absences : routes réelles, droits et calcul officiel",async(t)=>{
 const state=fixtureState(), engine=await loadConductRoutes(state);const {routes,request}=engine;
 try {
  await t.test("admin puis éducateur : une requête par lot, heures sauvegardées, note calculée",async()=>{
   const payload=body();payload.items.push({student_id:second,absence_hours:0});payload.override_total=1;
   let response=await routes.manual.POST(request("/api/admin/conduite/manual-absences",payload));assert.equal(response.status,200);assert.equal((await response.json()).saved,2);
   assert.equal(state.writes.length,1);assert.equal(state.tables.conduct_average_overrides[0].override_total,18,"aucune note fournie par le client n'est acceptée");
   const avg=await routes.averages.GET(request(`/api/admin/conduite/averages?class_id=${classroom}&academic_year=2026-2027&period_code=T1&from=2026-09-14&to=2026-12-04`));
   assert.equal(avg.status,200);const items=(await avg.json()).items;const record=items.find(r=>r.student_id===student);assert.equal(record.total,18);assert.equal(record.is_overridden,false);assert.equal(record.manual_absence_hours,4);
   state.tables.user_roles[0].role="educator";response=await routes.manual.POST(request("/api/admin/conduite/manual-absences",body("2,5")));assert.equal(response.status,200);
   assert.equal(state.tables.conduct_average_overrides.length,2,"la modification ne crée pas un doublon");
  });
  await t.test("aucune double comptabilisation avec le cahier numérique ; changement du barème recalculé",async()=>{
   state.digital[student]=30;state.tables.conduct_settings[0].points_per_absent_hour=1;
   const response=await routes.averages.GET(request(`/api/admin/conduite/averages?class_id=${classroom}&academic_year=2026-2027&period_code=T1`));
   const item=(await response.json()).items.find(r=>r.student_id===student);assert.equal(item.total,17.5);assert.equal(item.absence_count,2.5);assert.equal(item.absence_minutes,150);
   state.tables.conduct_settings[0].points_per_absent_hour=0.5;
  });
  await t.test("lecture par dates et espace parent : les mêmes heures alimentent la conduite",async()=>{
   const avg=await routes.averages.GET(request(`/api/admin/conduite/averages?class_id=${classroom}&from=2026-09-14&to=2026-12-04`));assert.equal((await avg.json()).items.find(r=>r.student_id===student).total,18.75);
   const parent=await routes.parent.GET(request(`/api/parent/children/conduct?student_id=${student}&from=2026-09-14&to=2026-12-04`));assert.equal(parent.status,200);const data=await parent.json();assert.equal(data.total,18.75);assert.equal(data.minutes.manual_absence_hours,2.5);
  });
  await t.test("enseignant, parent et rôle d’un autre établissement : écriture refusée",async()=>{
   for(const role of ["teacher","parent"]){state.tables.user_roles[0].role=role;assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",body()))).status,403);}
   state.tables.user_roles[0].role="admin";state.tables.user_roles[0].institution_id="other-school";assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",body()))).status,403);state.tables.user_roles[0].institution_id=state.tables.profiles[0].institution_id;
   state.signedIn=false;assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",body()))).status,401);state.signedIn=true;
  });
  await t.test("toute donnée invalide est rejetée avant la moindre écriture",async()=>{
   const before=state.writes.length;
   const invalid=[body(-1),body(""),body(5001),{...body(),class_id:otherClass},{...body(),academic_year:"2025-2026"},{...body(),period_code:"UNKNOWN"},{...body(),items:[{student_id:student,absence_hours:1},{student_id:student,absence_hours:2}]},{...body(),items:[{student_id:student,absence_hours:1},{student_id:"unknown",absence_hours:2}]}];
   for(const payload of invalid)assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",payload))).status,400);
   assert.equal(state.writes.length,before);
  });
  await t.test("les corrections de moyenne et d’assiduité existantes sont conservées",async()=>{
   const saved=state.tables.conduct_average_overrides[0].reason;state.tables.conduct_average_overrides[0].reason="Correction administrative";
   assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",body()))).status,409);state.tables.conduct_average_overrides[0].reason=saved;
   state.tables.conduct_rubric_overrides.push({institution_id:state.tables.profiles[0].institution_id,class_id:classroom,student_id:student,academic_year:"2026-2027",period_code:"T1",rubric_key:"assiduite",override_value:5});
   assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",body()))).status,409);state.tables.conduct_rubric_overrides=[];
  });
  await t.test("une panne ne valide pas l’enregistrement ; T2 est indépendant de T1",async()=>{
   const before=state.writes.length;state.failWrite=true;assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",body()))).status,500);assert.equal(state.writes.length,before);state.failWrite=false;
   assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",{...body(8),period_code:"T2"}))).status,200);assert.equal(state.tables.conduct_average_overrides.length,3);
   const response=await routes.averages.GET(request(`/api/admin/conduite/averages?class_id=${classroom}&academic_year=2026-2027&period_code=T2`));assert.equal((await response.json()).items.find(r=>r.student_id===student).total,16);
  });
  await t.test("une panne de lecture ne remplace pas les absences enregistrées par un faux zéro",async()=>{
   state.failReadTable="conduct_average_overrides";
   assert.equal((await routes.averages.GET(request(`/api/admin/conduite/averages?class_id=${classroom}&academic_year=2026-2027&period_code=T1`))).status,503);
   delete state.failReadTable;
  });
  await t.test("le stockage accepte aussi un barème dont le total diffère de 20",async()=>{
   state.tables.conduct_settings[0].assiduite_max=8;
   assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",body(0)))).status,200);
   assert.equal(state.tables.conduct_average_overrides[0].calculated_total,20);
   const response=await routes.averages.GET(request(`/api/admin/conduite/averages?class_id=${classroom}&academic_year=2026-2027&period_code=T1`));const result=await response.json();
   assert.equal(result.total_max,22);assert.equal(result.items.find(r=>r.student_id===student).total,22);
  });
 }finally{engine.restore();}
});
