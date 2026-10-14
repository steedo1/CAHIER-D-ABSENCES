// Exercise the actual routes with the real Supabase SDK and synthetic PostgREST data.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const { NextRequest } = require("next/server");
export const school="10000000-0000-0000-0000-000000000001", user="20000000-0000-0000-0000-000000000001";
export const classroom="30000000-0000-0000-0000-000000000001", otherClass="30000000-0000-0000-0000-000000000002";
export const student="40000000-0000-0000-0000-000000000001", second="40000000-0000-0000-0000-000000000002";
export function fixtureState() {
  const students=[{id:student,first_name:"MARIE",last_name:"KOFFI"},{id:second,first_name:"JEAN",last_name:"YAO"}];
  return { writes:[], failWrite:false, signedIn:true, digital:{}, tables:{
    profiles:[{id:user,institution_id:school}], user_roles:[{profile_id:user,role:"admin",institution_id:school}],
    educator_class_assignments:[{profile_id:user,institution_id:school,class_id:classroom,level:"3e"}],
    institutions:[{id:school,name:"COLLÈGE DE TEST",default_session_minutes:60,settings_json:{}}],
    classes:[{id:classroom,institution_id:school,label:"3e1",name:"3e1",level:"3e",academic_year:"2026-2027",education_type:"general_secondary"},{id:otherClass,institution_id:school,label:"3e2",name:"3e2",level:"3e",academic_year:"2026-2027",education_type:"general_secondary"}],
    grade_periods:[1,2,3].map(n=>({id:`50000000-0000-0000-0000-00000000000${n}`,institution_id:school,academic_year:"2026-2027",code:`T${n}`,label:`Trimestre ${n}`,short_label:`T${n}`,is_active:true,scope_type:"common",order_index:n,start_date:n===1?"2026-09-14":n===2?"2026-12-07":"2027-03-15",end_date:n===1?"2026-12-04":n===2?"2027-03-12":"2027-06-11"})),
    students, class_enrollments:students.map(s=>({student_id:s.id,class_id:classroom,institution_id:school,start_date:"2026-09-14",end_date:null,students:s})),
    student_guardians:students.map(s=>({student_id:s.id,institution_id:school,guardian_profile_id:user})),
    conduct_settings:[{institution_id:school,assiduite_max:6,tenue_max:3,moralite_max:4,discipline_max:7,points_per_absent_hour:0.5,absent_hours_zero_threshold:10,absent_hours_note_after_threshold:0,lateness_mode:"ignore"}],
    conduct_average_overrides:[],conduct_rubric_overrides:[],conduct_events:[],conduct_penalties:[],
  }};
}
function matches(row, condition) {
  const [key,op,...tail]=condition.split(".");const value=tail.join(".");
  if(op==="is")return value==="null" ? row[key]==null : String(row[key])===value;
  if(op==="eq")return String(row[key])===value;
  if(op==="gte")return row[key]!=null && String(row[key])>=value;
  if(op==="lte")return row[key]!=null && String(row[key])<=value;
  return true;
}
function sdk(state) {
  return createClient("https://supabase.test", "fake-service-key", {global:{fetch:async(input, init={})=>{
    const url=new URL(String(input)), table=url.pathname.split("/").at(-1);let rows=[...(state.tables[table]||[])];
    if(init.method==="POST") {
      if(state.failWrite)return Response.json({code:"XX000",message:"simulated failure"},{status:500});
      const payload=JSON.parse(init.body);const incoming=Array.isArray(payload)?payload:[payload];
      state.writes.push({table,items:incoming,onConflict:url.searchParams.get("on_conflict")});
      for(const item of incoming){const index=rows.findIndex(r=>["institution_id","class_id","student_id","academic_year","period_code"].every(k=>r[k]===item[k]));if(index<0)rows.push(item);else rows[index]={...rows[index],...item};}
      state.tables[table]=rows;return Response.json(incoming,{status:201});
    }
    if(state.failReadTable===table)return Response.json({code:"XX000",message:"simulated read failure"},{status:500});
    for(const [key,value]of url.searchParams) {
      if(value.startsWith("eq."))rows=rows.filter(r=>String(r[key])===value.slice(3));
      else if(value.startsWith("is."))rows=rows.filter(r=>value==="is.null"?r[key]==null:String(r[key])===value.slice(3));
      else if(value.startsWith("in.(")){const ids=value.slice(4,-1).split(",").map(v=>v.replaceAll('"',''));rows=rows.filter(r=>ids.includes(String(r[key])));}
      else if(value.startsWith("like.")){const prefix=value.slice(5).replace(/%$/,"");rows=rows.filter(r=>String(r[key]||"").startsWith(prefix));}
      else if(value.startsWith("gte."))rows=rows.filter(r=>r[key]!=null && String(r[key])>=value.slice(4));
      else if(value.startsWith("lte."))rows=rows.filter(r=>r[key]!=null && String(r[key])<=value.slice(4));
      else if(key==="or")rows=rows.filter(r=>value.slice(1,-1).split(",").some(c=>matches(r,c)));
    }
    if(url.searchParams.has("limit"))rows=rows.slice(0,Number(url.searchParams.get("limit")));
    const accept=new Headers(init.headers).get("accept")||"";
    return Response.json(accept.includes("object") ? rows[0]||null : rows);
  }}});
}
export async function loadConductRoutes(state) {
  const {build}=require("esbuild");
  const service=sdk(state);
  globalThis.__manualConductFixture={service,createAuth:()=>{const auth=sdk(state);auth.auth.getUser=async()=>({data:{user:state.signedIn?{id:user}:null},error:null});return auth;}};
  const plugins=[{name:"synthetic-auth",setup(build){
    build.onResolve({filter:/supabase-server$/},()=>({path:"auth",namespace:"fixture"}));
    build.onResolve({filter:/supabaseAdmin$/},()=>({path:"service",namespace:"fixture"}));
    build.onResolve({filter:/parent-connect\/server$/},()=>({path:"subscription",namespace:"fixture"}));
    build.onResolve({filter:/^next\/headers$/},()=>({path:"cookies",namespace:"fixture"}));
    build.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({contents:path==="auth"?'export const getSupabaseServerClient=async()=>globalThis.__manualConductFixture.createAuth(); export const getVerifiedServerUser=client=>client.auth.getUser();':path==="service"?'export const getSupabaseServiceClient=()=>globalThis.__manualConductFixture.service;':path==="cookies"?'export const cookies=async()=>({get:()=>undefined});':'export const parentConnectDenial=async()=>null;'}));
  }}];
  const entries={manual:"src/app/api/admin/conduite/manual-absences/route.ts",averages:"src/app/api/admin/conduite/averages/route.ts",parent:"src/app/api/parent/children/conduct/route.ts"};
  const compiled=await build({entryPoints:entries,bundle:true,platform:"node",format:"cjs",outdir:"fixture",write:false,external:["next/server","react"],plugins});
  const routes={};for(const output of compiled.outputFiles){const loaded={exports:{}};new Function("require","module","exports",output.text)(require,loaded,loaded.exports);routes[output.path.split("/").at(-1).replace(".js","")]=loaded.exports;}
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input=>{const url=new URL(String(input));if(url.pathname==="/api/admin/absences/by-class")return Response.json({items:state.tables.students.map(s=>({student_id:s.id,absence_count:state.digital[s.id]||0,absence_minutes:(state.digital[s.id]||0)*60}))});throw new Error(`Unexpected internal request: ${url}`);};
  return {routes,restore:()=>{globalThis.fetch=originalFetch;delete globalThis.__manualConductFixture;},request:(path,body)=>new NextRequest(`https://fixture.test${path}`,body===undefined?undefined:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})};
}
export async function startConductBrowserFixture() {
  const state=fixtureState();const engine=await loadConductRoutes(state);const {build}=require("esbuild");
  const js=await build({entryPoints:["test/manual-conduct-fixture.tsx"],bundle:true,write:false,jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},plugins:[{name:"auto-scope",setup(build){
    build.onResolve({filter:/EducationScopeFilter$/},()=>({path:"scope",namespace:"fixture"}));
    build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'export default function Scope(){return <div>Filtres du calcul automatique</div>}',loader:"tsx",resolveDir:process.cwd()}));
  }}]});
  const css=await require("postcss")([require("@tailwindcss/postcss")()]).process(await readFile("src/app/globals.css","utf8"),{from:"src/app/globals.css"});
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,"http://fixture.test");let response;
      if(url.pathname==="/fixture.js"){res.setHeader("Content-Type","text/javascript");res.end(js.outputFiles[0].text);return;}
      if(url.pathname==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css.css);return;}
      if(url.pathname==="/api/admin/conduite/averages")response=await engine.routes.averages.GET(engine.request(req.url));
      else if(url.pathname==="/api/admin/conduite/manual-absences"){
        let body="";for await(const chunk of req)body+=chunk;response=await engine.routes.manual.POST(engine.request(req.url,JSON.parse(body)));
      }else if(url.pathname==="/api/admin/classes")response=Response.json({items:state.tables.classes});
      else if(url.pathname==="/api/admin/institution/grading-periods")response=Response.json({ok:true,academic_year:url.searchParams.get("academic_year")||"2026-2027",items:state.tables.grade_periods});
      else if(url.pathname==="/api/admin/conduct/settings")response=Response.json(state.tables.conduct_settings[0]);
      else if(url.pathname==="/api/admin/institution/settings")response=Response.json({institution_name:"COLLÈGE DE TEST"});
      else {res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<!doctype html><html lang="fr"><head><link rel="stylesheet" href="/fixture.css"></head><body><main class="mx-auto max-w-6xl p-6"><div id="root"></div></main><script>window.__manualFixtureRole='+JSON.stringify(state.tables.user_roles[0].role)+'</script><script src="/fixture.js"></script></body></html>');return;}
      res.statusCode=response.status;res.setHeader("Content-Type","application/json");res.end(await response.text());
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return {state,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{await new Promise(resolve=>server.close(resolve));engine.restore();}};
}
