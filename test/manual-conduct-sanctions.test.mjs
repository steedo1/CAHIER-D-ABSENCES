import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureState, loadConductRoutes, classroom, otherClass, student, school } from "./manual-conduct-server.mjs";
const payload=(fields,period="T1")=>({class_id:classroom,academic_year:"2026-2027",period_code:period,items:[{student_id:student,...fields}]});
const averagePath=(period="T1")=>`/api/admin/conduite/averages?class_id=${classroom}&academic_year=2026-2027&period_code=${period}&from=2026-09-14&to=2026-12-04`;

test("Absences et sanctions : enregistrement, recalcul et protection des classes", async t=>{
  const state=fixtureState(),engine=await loadConductRoutes(state),{routes,request}=engine;
  const save=fields=>routes.manual.POST(request("/api/admin/conduite/manual-absences",payload(fields)));
  const item=async(period="T1")=>(await (await routes.averages.GET(request(averagePath(period)))).json()).items.find(row=>row.student_id===student);
  try {
    await t.test("4h et sanction 1 donnent 17 ; modifier puis remettre 0 ne cumule pas",async()=>{
      assert.equal((await save({absence_hours:4,sanction_points:1})).status,200);
      let row=await item();assert.equal(row.total,17);assert.equal(row.manual_sanction_points,1);assert.equal(row.manual_absence_hours,4);
      assert.equal((await save({sanction_points:"2,5"})).status,200);assert.equal((await item()).total,15.5);
      await save({sanction_points:2.5});assert.equal((await item()).total,15.5);assert.equal(state.tables.conduct_average_overrides.length,1);
      await save({sanction_points:0});assert.equal((await item()).total,18);
      await save({sanction_points:1});
      const byDates=await routes.averages.GET(request(`/api/admin/conduite/averages?class_id=${classroom}&from=2026-09-14&to=2026-12-04`));
      assert.equal((await byDates.json()).items.find(row=>row.student_id===student).total,17);
      const parent=await routes.parent.GET(request(`/api/parent/children/conduct?student_id=${student}&from=2026-09-14&to=2026-12-04`));
      const result=await parent.json();assert.equal(result.total,17);assert.equal(result.manual_sanction_points,1);
    });
    await t.test("un ancien client modifiant les absences conserve la sanction enregistrée",async()=>{
      await save({absence_hours:6});const row=await item();assert.equal(row.manual_sanction_points,1);assert.equal(row.total,16);
    });
    await t.test("sanction seule : le cahier numérique continue de faire évoluer les absences",async()=>{
      state.tables.conduct_average_overrides=[];state.digital[student]=4;
      await save({sanction_points:1});let row=await item();assert.equal(row.manual_absence_hours,null);assert.equal(row.total,17);
      state.digital[student]=6;row=await item();assert.equal(row.absence_count,6);assert.equal(row.total,16);
      await save({absence_hours:2});assert.equal((await item()).total,18);state.digital[student]=10;assert.equal((await item()).total,18);
    });
    await t.test("une correction d’assiduité reste intacte lors d’une sanction seule",async()=>{
      state.tables.conduct_rubric_overrides=[{institution_id:school,class_id:classroom,student_id:student,academic_year:"2026-2027",period_code:"T1",rubric_key:"assiduite",override_value:5}];
      assert.equal((await save({sanction_points:1})).status,200);assert.equal((await item()).total,18);
      assert.equal((await save({absence_hours:0,sanction_points:1})).status,409);state.tables.conduct_rubric_overrides=[];
    });
    await t.test("sanctions invalides, classe non affectée et panne n’écrivent rien",async()=>{
      const before=state.writes.length;
      for(const value of [-1,21,"",null,true,"1,234"])assert.equal((await save({sanction_points:value})).status,400);
      assert.equal((await save({})).status,400);
      state.tables.user_roles[0].role="educator";
      assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",{...payload({sanction_points:1}),class_id:otherClass}))).status,403);
      state.failWrite=true;assert.equal((await save({sanction_points:2})).status,500);state.failWrite=false;
      assert.equal(state.writes.length,before);
    });
    await t.test("trimestres séparés et note bornée à zéro",async()=>{
      assert.equal((await routes.manual.POST(request("/api/admin/conduite/manual-absences",payload({absence_hours:0,sanction_points:2},"T2")))).status,200);
      assert.equal((await item("T2")).total,18);assert.equal((await item()).manual_sanction_points,1);
      await save({sanction_points:20});assert.equal((await item()).total,0);
    });
  }finally{engine.restore();}
});

test("CSCA : spécificités de Discipline/Religion/Latin conservées dans la route réelle", async t=>{
  const state=fixtureState();state.tables.institutions[0].name="Cours Secondaire Catholique d'Aboisso";
  const latin="60000000-0000-0000-0000-000000000001",religion="60000000-0000-0000-0000-000000000002",math="60000000-0000-0000-0000-000000000003";
  state.tables.subjects=[{id:latin,name:"Latin"},{id:religion,name:"Religion"},{id:math,name:"Mathématiques"}];
  state.tables.institution_subjects=state.tables.subjects.map((s,index)=>({id:`70000000-0000-0000-0000-00000000000${index+1}`,institution_id:school,subject_id:s.id}));
  state.tables.grade_evaluations=state.tables.subjects.map((s,index)=>({id:`80000000-0000-0000-0000-00000000000${index+1}`,class_id:classroom,subject_id:s.id,scale:20,coeff:1,eval_date:"2026-10-01",is_published:true}));
  state.tables.v_grade_scores_official_for_reports=state.tables.grade_evaluations.map((e,index)=>({evaluation_id:e.id,student_id:student,score:[12,18,2][index]}));
  state.tables.student_grades=[{student_id:student,subject_id:latin,score:20}];
  const engine=await loadConductRoutes(state),{routes,request}=engine;
  const read=async()=>(await (await routes.averages.GET(request(averagePath()))).json()).items.find(row=>row.student_id===student);
  const save=fields=>routes.manual.POST(request("/api/admin/conduite/manual-absences",payload(fields)));
  try {
    await t.test("formule intacte, notes officielles seulement et exclusion des autres matières",async()=>{
      const row=await read();assert.equal(row.conduct_label,"Discipline");assert.equal(row.total,16.67);
      assert.deepEqual(row.conduct_policy_components.map(c=>c.label).sort(),["Discipline","Latin","Religion"].sort());
      assert.equal((await save({absence_hours:4,sanction_points:0})).status,200);assert.equal((await read()).total,16);
    });
    await t.test("1 point retire exactement 1 du résultat composé sans changer ses composantes",async()=>{
      const before=await read();await save({sanction_points:1});const after=await read();
      assert.equal(after.total,15);assert.equal(after.manual_conduct_base_total,16);assert.equal(after.classic_total,18);
      assert.deepEqual(after.conduct_policy_components,before.conduct_policy_components);
      state.tables.v_grade_scores_official_for_reports[1].score=10;assert.equal((await read()).total,12.33);
    });
    await t.test("matière manquante ignorée et zéro sanction restaure le résultat composé",async()=>{
      state.tables.v_grade_scores_official_for_reports[1].score=18;
      state.tables.v_grade_scores_official_for_reports=state.tables.v_grade_scores_official_for_reports.filter(row=>row.evaluation_id!==state.tables.grade_evaluations[0].id);
      const row=await read();assert.equal(row.total,17);assert.equal(row.conduct_policy_components.find(c=>c.subject_id===latin).included,false);
      await save({sanction_points:0});assert.equal((await read()).total,18);
    });
  }finally{engine.restore();}
});
