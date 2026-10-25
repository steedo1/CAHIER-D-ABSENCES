/** Real Next route handlers + local Supabase Auth/PostgREST/Storage.
 * Strictly refuses non-loopback servers. No production connector or key. */
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {readFile,writeFile,mkdir,appendFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import sharp from "sharp";
const localStatus=JSON.parse(await readFile(process.env.CARD_LOCAL_STATUS || "/tmp/card-supabase-status.json","utf8"));
const get=key=>localStatus[key]||localStatus[key.toLowerCase()];
const url=get("API_URL"),anon=get("ANON_KEY")||get("PUBLISHABLE_KEY"),serviceKey=get("SERVICE_ROLE_KEY")||get("SECRET_KEY"),database=get("DB_URL");
for(const endpoint of [url,database]) if(!endpoint || !["127.0.0.1","localhost"].includes(new URL(endpoint).hostname)) throw Error("native_card_test_refuses_non_loopback_database");
if(!anon||!serviceKey) throw Error("local_supabase_keys_unavailable");
const origin="http://localhost:4398",year="2026-2027",output="tmp/school-cards-native";
await mkdir(output,{recursive:true});
const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const sql=query=>execFileSync("psql",[database,"-X","-At","-v","ON_ERROR_STOP=1","-c",query],{encoding:"utf8"}).trim();
const check=result=>{if(result.error)throw Error(result.error.message);return result.data};
const phase=process.argv[2]||"test";
if(phase==="initialize"){
  for(const path of ["test/fixtures/school-cards-native-base.sql","supabase/migrations/20261025101927_school_cards_private_configuration.sql"])
    execFileSync("psql",[database,"-X","-v","ON_ERROR_STOP=1","-f",path],{stdio:"inherit"});
  sql("notify pgrst, 'reload schema'");
  process.exit(0);
}
if(phase==="prepare"){

  const secret=randomBytes(48).toString("base64url");
  // Production-mode Next correctly refuses HTTP printed origins. The reserved
  // HTTPS example is never contacted; scans below target the real loopback API.
  const variables={SUPABASE_URL:url,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:serviceKey,SCHOOL_CARDS_ENABLED:"true",SCHOOL_CARD_QR_SECRET:secret,SCHOOL_CARD_PUBLIC_ORIGIN:"https://cards.example.invalid",NEXT_PUBLIC_APP_URL:origin};
  if(!process.env.GITHUB_ENV)throw Error("prepare_requires_ephemeral_ci_environment");
  // GitHub's supported masking command prevents test credentials in step logs.
  for(const value of [serviceKey,secret])console.log(`::add-mask::${value}`);
  await appendFile(process.env.GITHUB_ENV,Object.entries(variables).map(([k,v])=>`${k}=${v}`).join("\n")+"\n");
  const schools=[];
  for(const [label,bilingual,count] of [["CSCA",false,1000],["Dieudonné",false,2],["EPC Dimbokro",true,4]]){
    const institutionId=randomUUID(),fr=randomUUID(),ar=randomUUID();
    const settings=bilingual?{school_cycles_v1:{version:1,enabled:true,enabledCycles:["primary"],classCycleById:{[fr]:"primary",[ar]:"primary"},teachingTracksByCycle:{primary:["french","arabic"]}},school_student_programs_v1:{version:1,years:{[year]:{classes:{[fr]:{tracks:["french"],students:{}},[ar]:{tracks:["arabic"],students:{}}}}}},school_teaching_signatories_v1:{version:1,french:{name:"Directeur français fictif"},arabic:{name:"Directeur arabe fictif"}}}:{};
    check(await service.from("institutions").insert({id:institutionId,name:`${label} — FICTIF CI LOCAL`,phone:"+225 0000000000",head_name:"Directeur fictif",country_name:"République de Côte d’Ivoire",settings_json:settings,subscription_expires_at:"2027-07-30"}));
    check(await service.from("academic_years").insert({institution_id:institutionId,code:year,start_date:"2026-08-31",end_date:"2027-07-30",is_current:true}));
    check(await service.from("classes").insert([fr,ar].map((id,i)=>({id,institution_id:institutionId,label:bilingual?(i?"CP1 AR":"CP1 FR"):(i?"6e B":"6e A"),level:bilingual?"CP1":"6e",academic_year:year,education_type:"general_secondary"}))));
    const students=Array.from({length:count},(_,i)=>({id:randomUUID(),institution_id:institutionId,full_name:i<2?"Traoré Ousmane":`Élève fictif ${i}`,matricule:`EPC26${String(i+1).padStart(4,"0")}`,birthdate:"2015-04-12",birth_place:"Yamoussoukro",gender:i%2?"F":"M",lifecycle_status:"active"}));
    const enrollments=students.map((s,i)=>({id:randomUUID(),institution_id:institutionId,student_id:s.id,class_id:i%2?ar:fr,start_date:"2026-08-31",end_date:null}));
    for(let i=0;i<count;i+=100){check(await service.from("students").insert(students.slice(i,i+100)));check(await service.from("class_enrollments").insert(enrollments.slice(i,i+100)))}
    const actors={};
    for(const role of ["admin","educator","teacher"]){
      const password=randomBytes(24).toString("base64url")+"!Aa1",email=`${randomUUID()}@example.invalid`;
      const created=check(await service.auth.admin.createUser({email,password,email_confirm:true}));
      check(await service.from("profiles").insert({id:created.user.id,institution_id:institutionId}));check(await service.from("user_roles").insert({profile_id:created.user.id,institution_id:institutionId,role}));
      const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),session=check(await client.auth.signInWithPassword({email,password})).session;
      assert.ok(session?.access_token);
      actors[role]={cookie:`sb-access-token=${session.access_token}; sb-refresh-token=${session.refresh_token}`,access:session.access_token};
      if(role==="educator")check(await service.from("educator_class_assignments").insert({institution_id:institutionId,profile_id:created.user.id,class_id:fr}));
    }
    schools.push({institutionId,fr,ar,students,enrollments,actors});
  }
  for(const bucket of ["student-photos","signatures"])check(await service.storage.createBucket(bucket,{public:false}));
  // Real private Storage upload; no actual child's image.
  const photo=await sharp({create:{width:240,height:320,channels:3,background:"#6b8f70"}}).jpeg().toBuffer();
  const pupil=schools[0].students[0],path=`${schools[0].institutionId}/${pupil.id}/portrait.jpg`;
  check(await service.storage.from("student-photos").upload(path,photo,{contentType:"image/jpeg"}));check(await service.from("students").update({photo_path:path}).eq("id",pupil.id));
  await writeFile("/tmp/card-native-fixtures.json",JSON.stringify(schools),{mode:0o600});console.log("Ephemeral Supabase seeded: 3 fictitious schools, real Auth and private Storage; no production connection.");
  process.exit(0);
}
const schools=JSON.parse(await readFile("/tmp/card-native-fixtures.json","utf8"));
async function api(school,path,body,role="admin",method=body?"POST":"GET"){
  const response=await fetch(origin+path,{method,headers:{Cookie:school.actors[role].cookie,Origin:origin,...(body instanceof FormData?{}:body?{"Content-Type":"application/json"}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
  return {response,data:await response.clone().json().catch(()=>null)};
}
const rosterPath="/api/admin/school-cards",first=schools[0];
const metrics=[];
for(const school of schools){
  const loaded=await api(school,rosterPath);assert.equal(loaded.response.status,200,JSON.stringify(loaded.data));assert.equal(loaded.data.school.id,school.institutionId);
  if(school===first)assert.equal(loaded.data.items.length,500,"real PostgREST pagination");
  const teacher=await api(school,rosterPath,null,"teacher");assert.equal(teacher.response.status,403);
  const educator=await api(school,rosterPath,null,"educator");assert.equal(educator.response.status,200);assert.ok(educator.data.items.every(row=>row.classId===school.fr));
  const forbidden=await api(school,"/api/admin/school-cards/settings",{revision:0,enabled:true,automaticSignature:true},"educator","PUT");assert.equal(forbidden.response.status,403);
}
const outsider=await api(schools[1],rosterPath,{year,enrollmentIds:[first.enrollments[0].id]});assert.equal(outsider.response.status,403);
const anonymous=await fetch(origin+rosterPath);assert.equal(anonymous.status,401);
// Reset only this ephemeral local database's SQL counters, after seeding.
const statsSchema=sql("select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_stat_statements'");
if(!/^[a-z_]+$/.test(statsSchema))throw Error("local_sql_metrics_extension_unavailable");
sql(`select ${statsSchema}.pg_stat_statements_reset()`);
for(const count of [500,1000]){
  const before=JSON.parse(sql("select json_build_object('settings',(select count(*) from school_card_settings),'audit',(select count(*) from school_card_audit),'revocations',(select count(*) from school_card_revocations))"));
  const start=Date.now(),prepared=[];
  for(let i=0;i<count;i+=100){const result=await api(first,rosterPath,{year,enrollmentIds:first.enrollments.slice(i,i+100).map(row=>row.id)});assert.equal(result.response.status,200,JSON.stringify(result.data));prepared.push(...result.data.items)}
  const again=await api(first,rosterPath,{year,enrollmentIds:first.enrollments.slice(0,100).map(row=>row.id)});assert.deepEqual(again.data.items.map(row=>row.token),prepared.slice(0,100).map(row=>row.token));
  const after=JSON.parse(sql("select json_build_object('settings',(select count(*) from school_card_settings),'audit',(select count(*) from school_card_audit),'revocations',(select count(*) from school_card_revocations))"));assert.deepEqual(after,before,"real preparation/reprint created no persistent rows");
  metrics.push({count,prepareAndReprintMs:Date.now()-start,persistentCardRowsBefore:before,persistentCardRowsAfter:after,scope:"real ephemeral local Supabase Auth/PostgREST/Storage via native Next handlers; excludes PDF timing"});
}
const card=(await api(first,rosterPath,{year,enrollmentIds:[first.enrollments[0].id]})).data.items[0];assert.ok(card.photoUrl);
assert.equal((await fetch(card.photoUrl)).status,200,"actual signed private photo download");
const publicPhoto=await fetch(`${url}/storage/v1/object/public/student-photos/${first.institutionId}/${first.students[0].id}/portrait.jpg`);assert.notEqual(publicPhoto.status,200,"private original must not become public");
const scan=async token=>{const r=await fetch(origin+"/api/public/school-cards/verify",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({token})});return {status:r.status,data:await r.json()}};
assert.equal((await scan(card.token)).data.valid,true);
assert.equal((await scan(card.token.slice(1))).data.valid,false);
let revoked=await api(first,"/api/admin/school-cards/revoke",{year,enrollmentIds:[card.enrollmentId],revoked:true});assert.equal(revoked.response.status,200,JSON.stringify(revoked.data));assert.equal((await scan(card.token)).data.valid,false);
await api(first,"/api/admin/school-cards/revoke",{year,enrollmentIds:[card.enrollmentId],revoked:false});
check(await service.from("class_enrollments").update({class_id:first.ar}).eq("id",card.enrollmentId));assert.equal((await scan(card.token)).data.valid,false,"class change invalidates old card");
check(await service.from("class_enrollments").update({class_id:first.fr}).eq("id",card.enrollmentId));
check(await service.from("academic_years").update({end_date:"2026-01-01"}).eq("institution_id",first.institutionId));assert.equal((await scan(card.token)).data.valid,false,"expired year");
check(await service.from("academic_years").update({end_date:"2027-07-30"}).eq("institution_id",first.institutionId));
const stamp=await sharp({create:{width:200,height:100,channels:4,background:{r:20,g:40,b:180,alpha:1}}}).png().toBuffer();
const form=action=>{const data=new FormData();data.set("file",new File([stamp],"stamp.png",{type:"image/png"}));data.set("slot","general");data.set("action",action);data.set("revision","0");data.set("authorized","true");data.set("removeBackground","false");data.set("crop","false");return data};
assert.equal((await api(first,"/api/admin/school-cards/signature",form("preview"))).response.status,200);
const saved=await api(first,"/api/admin/school-cards/signature",form("save"));assert.equal(saved.response.status,200,JSON.stringify(saved.data));
const config=check(await service.from("school_card_settings").select("configuration,revision").eq("institution_id",first.institutionId).single());
assert.ok(config.configuration.signatures.general.original.startsWith(`school-cards/${first.institutionId}/`));
assert.equal((await api(first,"/api/admin/school-cards/settings",{revision:config.revision,enabled:true,automaticSignature:true},"admin","PUT")).response.status,200);
const ready=await api(first,rosterPath,{year,enrollmentIds:[card.enrollmentId]});assert.equal(ready.data.items[0].signatureSlot,"general");assert.ok(ready.data.signatureImages.general.startsWith("data:image/png;base64,"));
const rawStamp=await fetch(`${url}/storage/v1/object/public/signatures/${config.configuration.signatures.general.original}`);assert.notEqual(rawStamp.status,200);
const unprivileged=createClient(url,anon,{auth:{persistSession:false}});const direct=await unprivileged.from("school_card_settings").select("*");assert.ok(direct.error||direct.data.length===0);
const stats=JSON.parse(sql(`select coalesce(json_agg(x),'[]'::json) from (select query,calls,rows from ${statsSchema}.pg_stat_statements where query like 'WITH pgrst_source%' and (query ilike '%school_card_%' or query ilike '%class_enrollments%' or query ilike '%students%') order by calls desc) x`));
const report={ok:true,environment:"ephemeral local Supabase, real HTTP services",metrics,checks:["real verified Auth cookies","PostgREST nested joins and pagination","three school configurations","teacher denied","educator class scope","cross-school denied","opaque stable QR batch 500/1000","no card-row writes during prepare/reprint","real private photo upload and signed download","public original denied","public scan valid/forged/revoked/class-changed/expired","real private composite signature preview/save/automatic application","anonymous table access denied"],postgresStatements:stats};
await writeFile(`${output}/native-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,postgresStatements:stats.map(({query,calls,rows})=>({operation:query.includes("INSERT INTO")?"insert":query.includes("UPDATE")?"update":"read",calls,rows}))},null,2));
