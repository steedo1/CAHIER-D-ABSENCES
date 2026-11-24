/** Real Next route handlers + local Supabase Auth/PostgREST/Storage.
 * Strictly refuses non-loopback servers. No production connector or key. */
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {readFile,writeFile,mkdir,appendFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import { productionUpload, productionArchiveStudent } from "../src/lib/production-nexa.ts";
import { renderCardPages } from "../src/lib/school-card-pdf.ts";
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
  for(const path of ["test/fixtures/school-cards-native-base.sql","supabase/migrations/20261025144859_school_cards_private_configuration.sql","supabase/migrations/20261114190251_production_nexa.sql"])
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
    check(await service.from("institutions").insert({id:institutionId,code:bilingual?"E020684":null,name:`${label} — FICTIF CI LOCAL`,phone:"+225 0000000000",head_name:"Directeur fictif",country_name:"République de Côte d’Ivoire",settings_json:settings,subscription_expires_at:"2027-07-30"}));
    check(await service.from("academic_years").insert({institution_id:institutionId,code:year,start_date:"2026-08-31",end_date:"2027-07-30",is_current:true}));
    check(await service.from("classes").insert([fr,ar].map((id,i)=>({id,institution_id:institutionId,label:bilingual?(i?"CP1 AR":"CP1 FR"):(i?"6e B":"6e A"),level:bilingual?"CP1":"6e",academic_year:year,education_type:"general_secondary"}))));
    const students=Array.from({length:count},(_,i)=>({id:randomUUID(),institution_id:institutionId,full_name:i<2?"Traoré Ousmane":`Élève fictif ${i}`,matricule:`EPC26${String(i+1).padStart(4,"0")}`,birthdate:"2015-04-12",birth_place:"Yamoussoukro",gender:i%2?"F":"M",lifecycle_status:"active"}));
    if (bilingual) {
      settings.school_student_programs_v1.years[year].classes[ar].linkedStudentIds=[students[0].id];
      check(await service.from("institutions").update({settings_json:settings}).eq("id",institutionId));
    }
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
  const superEmail=`${randomUUID()}@example.invalid`, superPassword=randomBytes(24).toString("base64url")+"!Aa1";
  const superUser=check(await service.auth.admin.createUser({email:superEmail,password:superPassword,email_confirm:true})).user;
  check(await service.from("profiles").insert({id:superUser.id,institution_id:null}));
  check(await service.from("user_roles").insert({profile_id:superUser.id,institution_id:null,role:"super_admin"}));
  const superClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const superSession=check(await superClient.auth.signInWithPassword({email:superEmail,password:superPassword})).session;
  schools[0].actors.super_admin={cookie:`sb-access-token=${superSession.access_token}; sb-refresh-token=${superSession.refresh_token}`};

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
  const response=await fetch(origin+path,{method,redirect:"manual",headers:{Cookie:school.actors[role].cookie,Origin:origin,...(body instanceof FormData?{}:body?{"Content-Type":"application/json"}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
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
const epc=schools[2], pupil=epc.students[0], production="/api/production-nexa";
const requireStatus=(result,status)=>{assert.equal(result.response.status,status,JSON.stringify(result.data));return result.data;};
const schoolScope=`school=${epc.institutionId}&year=${year}`;
const submit=async ids=>api(epc,`${rosterPath}/orders`,{action:"order",year,studentIds:ids});
const [one,two]=await Promise.all([submit([pupil.id]),submit([pupil.id,pupil.id])]);
const order=requireStatus(one,200);
assert.equal(requireStatus(two,200).orderId,order.orderId);
requireStatus(await submit([first.students[0].id]),403);
requireStatus(await api(epc,rosterPath,{year,enrollmentIds:[epc.enrollments[0].id]}),403);
const preview=requireStatus(await api(epc,rosterPath,{action:"preview",year,studentId:pupil.id}),200);
assert.deepEqual(Object.keys(preview).sort(),["back","front"]);
assert.match(preview.front,/^data:image\/jpeg;base64,/);
const photoInfo=requireStatus(await api(first,rosterPath),200);
assert.ok(photoInfo.items.every(item=>item.photoUrl === null));
const privatePhoto=await fetch(`${url}/storage/v1/object/public/student-photos/${first.institutionId}/${first.students[0].id}/portrait.jpg`);
assert.notEqual(privatePhoto.status,200);

const permissions=["cards.read","cards.orders","cards.generate","cards.download"];
const supervisor="/api/super/production-nexa";
const email=`${randomUUID()}@example.invalid`;
const created=requireStatus(await api(first,supervisor,{action:"create",email,status:"active",
  permissions,allSchools:false,institutionIds:[epc.institutionId]},"super_admin"),201);
const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const session=check(await auth.auth.signInWithPassword({email,password:created.password})).session;
assert.equal(session.user.role,"nexa_production");
epc.actors.production={cookie:`sb-access-token=${session.access_token}; sb-refresh-token=${session.refresh_token}`};
const role=requireStatus(await api(epc,"/api/auth/role",null,"production"),200);
assert.equal(role.role,"nexa_production");
assert.equal(role.offline_access,null);
const redirect=await api(epc,"/redirect",null,"production");
assert.equal(new URL(redirect.response.headers.get("location")).pathname,"/production-nexa");
requireStatus(await api(epc,rosterPath,null,"production"),403);
requireStatus(await api(epc,supervisor,null,"production"),403);
requireStatus(await api(epc,`${production}?school=${first.institutionId}&view=years`,null,"production"),403);
assert.ok((await auth.from("institutions").select("id")).error,"a production token has no PostgREST role");
assert.ok((await auth.rpc("fn_upsert_role",{profile_id:session.user.id,institution_id:epc.institutionId,role:"super_admin"})).error);
const adminSession=epc.actors.admin.access;
const legacyEscalation=await fetch(`${url}/rest/v1/rpc/fn_upsert_role`,{
  method:"POST",headers:{apikey:anon,Authorization:`Bearer ${adminSession}`,"Content-Type":"application/json"},
  body:JSON.stringify({profile_id:session.user.id,institution_id:epc.institutionId,role:"super_admin"}),
});
assert.notEqual(legacyEscalation.status,200);
assert.notEqual(legacyEscalation.status,204);

const orderList=requireStatus(await api(epc,`${production}?${schoolScope}&view=orders`,null,"production"),200);
assert.equal(orderList.orders[0].id,order.orderId);
const status=(value,revision)=>api(epc,production,{action:"orderStatus",school:epc.institutionId,year,
  orderId:order.orderId,status:value,revision},"production");
requireStatus(await status("preparing",1),200);
requireStatus(await status("ready",2),409);
const prepared=requireStatus(await api(epc,production,{action:"generation",school:epc.institutionId,year,orderId:order.orderId,
  studentIds:[pupil.id],format:"pvc",flip:"long",allowMissing:true},"production"),200);
assert.equal(prepared.items.length,1);
assert.deepEqual(prepared.items[0].classes.map(item=>item.label),["CP1 FR","CP1 AR"]);
const font=await readFile("public/card-fonts/DejaVuSans.ttf");
const doc=new PDFDocument({autoFirstPage:false}),chunks=[];
const done=new Promise((resolve,reject)=>{doc.on("data",chunk=>chunks.push(chunk));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
renderCardPages(doc,prepared.items,prepared.school,{font,photos:new Map(),signatures:prepared.signatures,stamps:prepared.stamps},{individual:true});doc.end();
const pdf=await done;
const payload=productionUpload(new Blob([new Uint8Array(pdf)]),prepared.items.map(productionArchiveStudent));
const upload=await fetch(origin+production+"/archive",{method:"POST",headers:{Cookie:epc.actors.production.cookie,Origin:origin,
  "Content-Type":payload.type,"X-Nexa-Production-Ticket":prepared.ticket},body:payload});
assert.equal(upload.status,201);
const {archive}=await upload.json();
requireStatus(await status("ready",2),200);
requireStatus(await status("completed",3),200);
const downloadPath=`${production}/archive/${archive.id}?school=${epc.institutionId}`;
requireStatus(await api(epc,downloadPath),403);
const downloaded=await api(epc,downloadPath,null,"production");
assert.equal(downloaded.response.status,200);
assert.deepEqual(Buffer.from(await downloaded.response.arrayBuffer()),pdf);
const object=`${epc.institutionId}/${year}/${archive.id}.pdf`;
for(const prefix of ["public","authenticated"]) {
  const direct=await fetch(`${url}/storage/v1/object/${prefix}/nexa-production-cards/${object}`,
    {headers:{apikey:anon,Authorization:`Bearer ${adminSession}`}});
  assert.notEqual(direct.status,200);
}
const history=requireStatus(await api(epc,`${production}?${schoolScope}&view=history&id=${archive.id}`,null,"production"),200);
assert.deepEqual(new Set(history.history.map(item=>item.action)),new Set(["generated","downloaded"]));
requireStatus(await api(first,supervisor,{action:"update",userId:session.user.id,revision:1,status:"disabled",permissions,
  allSchools:false,institutionIds:[epc.institutionId]},"super_admin"),200);
requireStatus(await api(epc,downloadPath,null,"production"),403);
const result={ok:true,schools:schools.length,productionBytes:pdf.length,protectedPreviewBytes:Buffer.byteLength(preview.front)+Buffer.byteLength(preview.back),
  checks:["native Supabase Auth role and PostgREST isolation","concurrent order deduplication","school isolation","order status transitions",
    "single dual-class PVC card","private Storage and audited download","immediate disable"]};
await writeFile(`${output}/native-results.json`,JSON.stringify(result,null,2));console.log(result);
