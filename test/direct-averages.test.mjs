import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fixtureState, school, user, classroom, student, second } from './manual-conduct-server.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const { NextRequest } = require('next/server');
const subject='60000000-0000-0000-0000-000000000001', local='60000000-0000-0000-0000-000000000002';
const year='2026-2027', period=n=>`50000000-0000-0000-0000-00000000000${n}`;
function state() {
  const s=fixtureState();
  s.tables.subjects=[{id:subject,name:'Mathématiques',code:'MATH'}];
  s.tables.institution_subjects=[{id:local,institution_id:school,subject_id:subject,subjects:s.tables.subjects[0]}];
  s.tables.institution_subject_coeffs=[{institution_id:school,subject_id:subject,level:'3e',coeff:2,include_in_average:true}];
  s.tables.class_teachers=[{id:randomUUID(),institution_id:school,class_id:classroom,teacher_id:user,subject_id:local,start_date:'2026-09-14',end_date:null}];
  s.tables.grade_adjustments=[];
  s.calls=[];return s;
}
function sdk(s) {
 return createClient('https://fixture.supabase.test','test-key',{global:{fetch:async(input,init={})=>{
  const url=new URL(String(input)), table=url.pathname.split('/').at(-1), method=init.method||'GET';
  s.calls.push({table,method});
  if(s.failReadTable===table&&method==='GET')return Response.json({code:'XX000',message:'lecture indisponible'},{status:503});
  let rows=[...(s.tables[table]||[])];
  const matches=(r,key,condition)=>{
   const i=condition.indexOf('.'), op=condition.slice(0,i), value=condition.slice(i+1);
   if(op==='eq')return String(r[key])===value;
   if(op==='is')return value==='null'?r[key]==null:String(r[key])===value;
   if(op==='gte')return r[key]!=null&&String(r[key])>=value;
   if(op==='lte')return r[key]!=null&&String(r[key])<=value;
   if(op==='gt')return Number(r[key])>Number(value);
   if(op==='in')return value.slice(1,-1).split(',').map(v=>v.replaceAll('"','')).includes(String(r[key]));
   if(op==='like')return String(r[key]||'').startsWith(value.replace(/%$/,''));
   return true;
  };
  const filter=r=>[...url.searchParams].every(([key,value])=>{
   if(key==='or')return value.slice(1,-1).split(',').some(c=>{const i=c.indexOf('.');return matches(r,c.slice(0,i),c.slice(i+1));});
   return matches(r,key,value);
  });
  if(method==='POST'){
   if(s.failWrite)return Response.json({code:'XX000',message:'écriture indisponible'},{status:500});
   const raw=JSON.parse(init.body), items=Array.isArray(raw)?raw:[raw];
   if(table==='grade_adjustments' && items.some(item=>rows.some(row=>['class_id','subject_id','student_id','academic_year'].every(k=>row[k]===item[k]))))return Response.json({code:'23505',message:'duplicate'},{status:409});
   for(const item of items){const keys=table==='conduct_average_overrides'?['institution_id','class_id','student_id','academic_year','period_code']:['id'];const i=rows.findIndex(row=>keys.every(k=>row[k]===item[k]));if(i>=0)rows[i]={...rows[i],...item};else rows.push({id:randomUUID(),...item});}
   s.tables[table]=rows;s.writes.push({table,items});return Response.json(items,{status:201});
  }
  let selected=rows.filter(filter);
  if(method==='PATCH'){
   if(s.failWrite)return Response.json({code:'XX000',message:'écriture indisponible'},{status:500});
   if(s.raceReason&&table==='grade_adjustments'){rows[0].reason=s.raceReason;delete s.raceReason;selected=rows.filter(filter);}
   const patch=JSON.parse(init.body);for(const row of selected)Object.assign(row,patch);s.writes.push({table,items:selected});return Response.json(selected);
  }
  if(method==='DELETE'){s.tables[table]=rows.filter(r=>!filter(r));return new Response(null,{status:204});}
  const count=selected.length;
  if(url.searchParams.has('offset'))selected=selected.slice(Number(url.searchParams.get('offset')));
  if(url.searchParams.has('limit'))selected=selected.slice(0,Number(url.searchParams.get('limit')));
  const headers=new Headers(init.headers), object=(headers.get('accept')||'').includes('object');
  return Response.json(object?selected[0]||null:selected,{headers:{'content-range':`0-${Math.max(0,count-1)}/${count}`}});
 }}});
}
async function engine(s){
 const service=sdk(s);
 globalThis.__directFixture={service,auth:()=>{const c=sdk(s);c.auth.getUser=async()=>({data:{user:s.signedIn?{id:user}:null},error:null});return c;}};
 const plugins=[{name:'fixture',setup(build){
  build.onResolve({filter:/supabase-server$/},()=>({path:'auth',namespace:'fixture'}));
  build.onResolve({filter:/supabaseAdmin$/},()=>({path:'service',namespace:'fixture'}));
  build.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth'?'export const getSupabaseServerClient=async()=>globalThis.__directFixture.auth();export const getVerifiedServerUser=c=>c.auth.getUser();':path==='service'?'export const getSupabaseServiceClient=()=>globalThis.__directFixture.service;':'export const cookies=async()=>({get:()=>undefined});'}));
 }}];
 const entries={teacherBonus:'src/app/api/teacher/grades/adjustments/bulk/route.ts',genericBonus:'src/app/api/grades/adjustments/bulk/route.ts',qr:'src/lib/bulletin-qr.ts',values:'src/lib/grades/direct-subject-averages.ts',public:'src/app/api/public/bulletins/verify/route.ts',direct:'src/app/api/admin/grades/direct-averages/route.ts',bulletin:'src/app/api/admin/grades/bulletin/route.ts',averages:'src/app/api/grades/averages/route.ts',teacher:'src/app/api/teacher/grades/averages/route.ts',conduct:'src/app/api/admin/conduite/overrides/route.ts',conductAverage:'src/app/api/admin/conduite/averages/route.ts',manual:'src/app/api/admin/conduite/manual-absences/route.ts',register:'src/app/api/admin/grades/register/route.ts'};
 const built=await require('esbuild').build({entryPoints:entries,bundle:true,platform:'node',format:'cjs',outdir:'fixture',write:false,external:['next/server','react'],plugins});
 const routes={};for(const output of built.outputFiles){const module={exports:{}};new Function('require','module','exports',output.text)(require,module,module.exports);routes[output.path.split('/').at(-1).replace('.js','')]=module.exports;}
 const request=(path,body,method=body===undefined?'GET':'POST')=>new NextRequest('https://fixture.test'+path,body===undefined?undefined:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const oldFetch=globalThis.fetch;globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.pathname==='/api/admin/conduite/averages')return routes.conductAverage.GET(request(url.pathname+url.search));
  if(url.pathname==='/api/admin/absences/by-class')return Response.json({items:s.tables.students.map(row=>({student_id:row.id,absence_count:0,absence_minutes:0}))});
  throw new Error('Unexpected internal URL '+url);
 };
 return {routes,request,close(){globalThis.fetch=oldFetch;delete globalThis.__directFixture;}};
}
const body=(average='12,50',n=1,id=student)=>({class_id:classroom,subject_id:local,grading_period_id:period(n),items:[{student_id:id,average}]});
const query=(n=1)=>`?class_id=${classroom}&subject_id=${subject}&grading_period_id=${period(n)}`;

test('Moyennes directes : vraies routes, droits, trimestres, bulletins, conduite et retour au calcul',async t=>{
 const s=state(), e=await engine(s), {routes,request}=e;
 try{
  await t.test('admin et correspondant : moyenne enregistrée sans créer de devoir ni modifier le bonus',async()=>{
   s.tables.grade_adjustments.push({id:randomUUID(),class_id:classroom,subject_id:subject,student_id:student,academic_year:year,grading_period_id:period(1),bonus:1,reason:'Bonus antérieur'});
   for(const role of ['admin','file_correspondent']){s.tables.user_roles[0].role=role;const r=await routes.direct.POST(request('/direct',body()));assert.equal(r.status,200,await r.text());}
   assert.equal(s.tables.grade_adjustments.length,1);assert.equal(s.tables.grade_adjustments[0].bonus,1);assert.equal(s.tables.grade_evaluations,undefined);
   const get=await routes.direct.GET(request('/direct'+query()));assert.equal(get.status,200);assert.equal((await get.json()).items.find(row=>row.student_id===student).average,12.5);
   const register=await routes.register.GET(request(`/register?class_id=${classroom}&grading_period_id=${period(1)}&view=overview`));assert.equal(register.status,200,await register.text());
  });
  await t.test('zéro conservé, T1 et T2 indépendants, lecteurs enseignant et générique cohérents même sans devoir',async()=>{
   assert.equal((await routes.direct.POST(request('/direct',body(0,2)))).status,200);
   for(const reader of ['averages','teacher'])for(const [n,average] of [[1,12.5],[2,0]]){
    const res=await routes[reader].GET(request('/averages'+query(n)));assert.equal(res.status,200);const data=await res.json();assert.equal(data.items.find(row=>row.student_id===student)?.average,average,JSON.stringify(data));
   }
  });
  await t.test('les moyennes sans devoir ne deviennent pas lisibles par un parent ou un enseignant non affecté',async()=>{
   for(const role of ['parent','teacher']){
    s.tables.user_roles[0].role=role;
    const teacherId=s.tables.class_teachers[0].teacher_id;s.tables.class_teachers[0].teacher_id=randomUUID();
    for(const reader of ['averages','teacher'])assert.equal((await routes[reader].GET(request('/averages'+query()))).status,403);
    s.tables.class_teachers[0].teacher_id=teacherId;
   }
   s.tables.user_roles[0].role='teacher';
   for(const reader of ['averages','teacher'])assert.equal((await routes[reader].GET(request('/averages'+query()))).status,200);
   s.tables.user_roles[0].role='file_correspondent';
  });
  await t.test('bulletin réel : la moyenne finale et le rang sont présents sans notes publiées',async()=>{
   await routes.direct.POST(request('/direct',body(15,1,second)));
   const res=await routes.bulletin.GET(request(`/bulletin?class_id=${classroom}&from=2026-09-14&to=2026-12-04&export_light=1`));
   assert.equal(res.status,200,await res.clone().text());const data=await res.json();
   const one=data.items.find(row=>row.student_id===student), two=data.items.find(row=>row.student_id===second);
   assert.equal(one.per_subject.find(row=>row.subject_id===subject).avg20,12.5,JSON.stringify(data));assert.equal(one.per_subject.find(row=>row.subject_id===subject).bonus,0);
   assert.ok(one.general_avg!==null);assert.ok(two.rank<one.rank);
  });
  await t.test('bulletins annuels et QR : trois périodes saisies sans devoir, même moyenne annuelle',async()=>{
   for(const [n,value] of [[1,10],[2,12],[3,14]])await routes.direct.POST(request('/direct',body(value,n)));
   const path=`/bulletin?class_id=${classroom}&from=2027-03-15&to=2027-06-11&export_light=1`;
   const res=await routes.bulletin.GET(request(path));assert.equal(res.status,200,await res.clone().text());const data=await res.json();
   const one=data.items.find(row=>row.student_id===student);assert.equal(one.per_subject.find(row=>row.subject_id===subject).avg20,14);assert.ok(one.annual_avg!==null,JSON.stringify(one));
   const previous=process.env.BULLETIN_QR_SECRET;process.env.BULLETIN_QR_SECRET='test-direct-averages';
   try {
    const token=routes.qr.signBulletinQR({instId:school,classId:classroom,studentId:student,academicYear:year,from:'2027-03-15',to:'2027-06-11'});
    const response=await routes.public.GET(request('/verify?t='+encodeURIComponent(token)));assert.equal(response.status,200,await response.clone().text());const publicData=await response.json();
    assert.equal(publicData.bulletin.per_subject.find(row=>row.subject_id===subject).avg20,14);
    assert.equal(publicData.bulletin.annual_avg,one.annual_avg);
   } finally {if(previous===undefined)delete process.env.BULLETIN_QR_SECRET;else process.env.BULLETIN_QR_SECRET=previous;}
   // Restore the earlier scenario for the removal test.
   await routes.direct.POST(request('/direct',body(12.5,1)));await routes.direct.POST(request('/direct',body(0,2)));await routes.direct.POST(request('/direct',body(null,3)));
  });
  await t.test('la conduite composite conserve sa formule et utilise la moyenne matière directe',async()=>{
   s.tables.institution_conduct_policies=[{institution_id:school,mode:'conduct_plus_subjects',classic_conduct_weight:1,missing_subject_strategy:'ignore_missing',is_active:true}];
   s.tables.institution_subject_grade_policies=[{institution_id:school,subject_id:subject,conduct_weight:1,include_in_conduct_average:true,is_active:true}];
   const res=await routes.conductAverage.GET(request(`/conductAverage?class_id=${classroom}&academic_year=${year}&period_code=T1&from=2026-09-14&to=2026-12-04`));
   assert.equal(res.status,200);assert.equal((await res.json()).items.find(row=>row.student_id===student).total,16.25);
   s.tables.institution_conduct_policies=[];s.tables.institution_subject_grade_policies=[];
  });
  await t.test('une écriture concurrente d’un autre trimestre est préservée',async()=>{
   s.raceReason=routes.values.setDirectAverage(s.tables.grade_adjustments[0].reason,period(3),19,user,new Date().toISOString());
   assert.equal((await routes.direct.POST(request('/direct',body(12.5,1)))).status,200);
   const get=await routes.direct.GET(request('/direct'+query(3)));assert.equal((await get.json()).items.find(row=>row.student_id===student).average,19);
   await routes.direct.POST(request('/direct',body(null,3)));
  });
  await t.test('données invalides et droits hors établissement refusés avant écriture',async()=>{
   const before=s.writes.length;
   for(const invalid of [-1,20.01,'','1e1','12,123',true])assert.equal((await routes.direct.POST(request('/direct',body(invalid)))).status,400);
   assert.equal((await routes.direct.POST(request('/direct',{...body(),items:[{student_id:randomUUID(),average:12}]}))).status,400);
   assert.equal((await routes.direct.POST(request('/direct',{...body(),grading_period_id:randomUUID()}))).status,400);
   for(const role of ['teacher','parent','educator','finance_manager']){s.tables.user_roles[0].role=role;assert.equal((await routes.direct.POST(request('/direct',body()))).status,403);}
   s.tables.user_roles[0].role='admin';s.tables.user_roles[0].institution_id=randomUUID();assert.equal((await routes.direct.POST(request('/direct',body()))).status,403);s.tables.user_roles[0].institution_id=school;
   s.signedIn=false;assert.equal((await routes.direct.GET(request('/direct'+query()))).status,401);s.signedIn=true;
   const level=s.tables.classes[0].level;s.tables.classes[0].level='CP1';assert.equal((await routes.direct.POST(request('/direct',body()))).status,400);s.tables.classes[0].level=level;
   assert.equal((await routes.direct.POST(request('/direct',{...body(),items:[{student_id:student,average:12},{student_id:student,average:13}]}))).status,400);
   assert.equal(s.writes.length,before);
  });
  await t.test('échec de sauvegarde et de lecture signalé ; les valeurs existantes restent conservées',async()=>{
   s.failWrite=true;const res=await routes.direct.POST(request('/direct',body(19)));assert.equal(res.status,500);assert.deepEqual((await res.json()).saved,[]);s.failWrite=false;
   s.failReadTable='grade_adjustments';assert.equal((await routes.direct.GET(request('/direct'+query()))).status,500);delete s.failReadTable;
  });
  await t.test('suppression de T1 conserve T2, bonus et motif antérieurs',async()=>{
   assert.equal((await routes.direct.POST(request('/direct',body(null)))).status,200);
   const get=await routes.direct.GET(request('/direct'+query()));assert.equal((await get.json()).items.find(row=>row.student_id===student).average,null);
   assert.equal((await (await routes.direct.GET(request('/direct'+query(2)))).json()).items.find(row=>row.student_id===student).average,0);
   await routes.direct.POST(request('/direct',body(null,2)));assert.equal(s.tables.grade_adjustments[0].reason,'Bonus antérieur');assert.equal(s.tables.grade_adjustments[0].bonus,1);
  });
  await t.test('le retrait de la saisie directe rétablit le calcul des notes et du bonus',async()=>{
   const ev={id:randomUUID(),class_id:classroom,subject_id:subject,teacher_id:user,academic_year:year,grading_period_id:period(1),eval_date:'2026-10-01',scale:20,coeff:1,is_published:true};
   s.tables.grade_evaluations=[ev];const score={evaluation_id:ev.id,student_id:student,score:8};s.tables.student_grades=[score];s.tables.v_grade_scores_official_for_reports=[score];
   const response=await routes.bulletin.GET(request(`/bulletin?class_id=${classroom}&from=2026-09-14&to=2026-12-04&export_light=1`));const data=await response.json();
   assert.equal(data.items.find(row=>row.student_id===student).per_subject.find(row=>row.subject_id===subject).avg20,9);
   for(const reader of ['teacher','averages']){const res=await routes[reader].GET(request('/averages'+query()));assert.equal((await res.json()).items.find(row=>row.student_id===student).average,9);}
   s.tables.grade_evaluations=[];s.tables.student_grades=[];s.tables.v_grade_scores_official_for_reports=[];
  });
  await t.test('une source directe seule ne bloque pas le premier bonus enseignant et sa suppression le conserve',async()=>{
   for(const route of ['teacherBonus','genericBonus']){
    const id=randomUUID(), name={id,last_name:'TEST',first_name:route};s.tables.students.push(name);s.tables.class_enrollments.push({institution_id:school,class_id:classroom,student_id:id,end_date:null,students:name});
    assert.equal((await routes.direct.POST(request('/direct',body(13,1,id)))).status,200);
    const row=s.tables.grade_adjustments.find(row=>row.student_id===id), source=row.reason;
    const response=await routes[route].POST(request('/bonus',{class_id:classroom,subject_id:subject,academic_year:year,grading_period_id:period(1),items:[{student_id:id,bonus:0.5}]}));
    assert.equal(response.status,200,await response.text());assert.equal(row.bonus,0.5);assert.equal(row.reason,source);
    assert.equal((await routes.direct.POST(request('/direct',body(null,1,id)))).status,200);assert.equal(row.bonus,0.5);assert.equal(row.reason,null);
   }
  });
  await t.test('Français collège : sous-matières réelles, moyenne pondérée et bulletin',async()=>{
    const before=structuredClone(s.tables.grade_adjustments);
    const comps=[
      {id:randomUUID(),institution_id:school,subject_id:subject,level:'3eme',code:'c1',label:'Composition française',short_label:'Composition',coeff_in_subject:2,order_index:1,is_active:true},
      {id:randomUUID(),institution_id:school,subject_id:subject,level:'3eme',code:'c2',label:'Expression orale',short_label:'Oral',coeff_in_subject:1,order_index:2,is_active:true},
      {id:randomUUID(),institution_id:school,subject_id:subject,level:'3eme',code:'c3',label:'Orthographe-Grammaire',short_label:'Orthographe',coeff_in_subject:1,order_index:3,is_active:true},
    ];
    s.tables.grade_subject_components=comps;
    try{
      s.tables.user_roles[0].role='file_correspondent';
      const params='/direct'+query();
      const get=await routes.direct.GET(request(params));
      assert.equal(get.status,200,await get.clone().text());
      const data=await get.json();
      assert.deepEqual(data.components.map(row=>[row.label,row.coeff]),
        [['Composition',2],['Oral',1],['Orthographe',1]]);
      const values=Object.fromEntries(comps.map((c,i)=>[c.id,[14.5,12,13][i]]));
      const body={class_id:classroom,subject_id:local,grading_period_id:period(1),
        items:[{student_id:student,components:values}]};
      const saved=await routes.direct.POST(request('/direct',body));
      assert.equal(saved.status,200,await saved.clone().text());
      const savedJson=await saved.json();
      assert.equal(savedJson.values[0].average,13.5);
      const fresh=await routes.direct.GET(request(params));
      const row=(await fresh.json()).items.find(r=>r.student_id===student);
      assert.equal(row.average,13.5);
      assert.deepEqual(row.component_averages,values);
      const result=await routes.bulletin.GET(request(
        '/bulletin?class_id='+classroom+'&from=2026-09-14&to=2026-12-04&export_light=1'));
      assert.equal(result.status,200,await result.clone().text());
      const pupil=(await result.json()).items.find(r=>r.student_id===student);
      assert.equal(pupil.per_subject.find(r=>r.subject_id===subject).avg20,13.5);
      for(const [id,avg] of Object.entries(values)){
        assert.equal(pupil.per_subject_components.find(r=>r.component_id===id)?.avg20,avg);
      }
      const other=await routes.direct.GET(request('/direct'+query(2)));
      assert.equal((await other.json()).items.find(r=>r.student_id===student).average,0);
    } finally {
      s.tables.grade_adjustments=before;
      s.tables.grade_subject_components=[];
      s.tables.user_roles[0].role='file_correspondent';
    }
  });
  await t.test('conduite directe : correspondant autorisé, absences conservées, réinitialisation fidèle',async()=>{
   s.tables.user_roles[0].role='admin';
   const manual={class_id:classroom,academic_year:year,period_code:'T1',items:[{student_id:student,absence_hours:4,sanction_points:1}]};
   assert.equal((await routes.manual.POST(request('/manual',manual))).status,200);
   const previous={...s.tables.conduct_average_overrides[0]};s.tables.user_roles[0].role='file_correspondent';
   const direct={class_id:classroom,student_id:student,academic_year:year,period_code:'T1',override_total:'16,50',direct_entry:true};
   const response=await routes.conduct.POST(request('/conduct',direct));assert.equal(response.status,200,await response.text());
   const res=await routes.conductAverage.GET(request(`/conductAverage?class_id=${classroom}&academic_year=${year}&period_code=T1&from=2026-09-14&to=2026-12-04`));assert.equal(res.status,200);const row=(await res.json()).items.find(row=>row.student_id===student);assert.equal(row.total,16.5);assert.equal(row.manual_absence_hours,4);assert.equal(row.is_overridden,true);
   assert.equal((await routes.conduct.DELETE(request('/conduct',direct,'DELETE'))).status,200);assert.equal(s.tables.conduct_average_overrides[0].reason,previous.reason);assert.equal(s.tables.conduct_average_overrides[0].override_total,previous.override_total);
  });
 }finally{e.close();}
});
