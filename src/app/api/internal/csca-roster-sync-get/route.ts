import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INST_ID="ee34ab2a-8033-4e0b-acf0-05979cce1697";
const YEAR_ID="c9fd3138-6234-4ff4-ac21-cdcdb2a876aa";
const YEAR="2026-2027";
const START_DATE="2026-09-09";
const TOKEN_HASH="abfe894200157e3e7ea04bd410c66e91454fa92238f9e0e4cc9a73dc72cbbfda";
const ALLOWED=new Set(["5e1","5e2","4e1","4e2","4e3","3e1","3e2","3e3","1a1","1d1","t-d1","t-d2","ta1","ta2"]);
const PROTECTED=new Set(["6e1","6e2","2a1","2c1","2dea","2de-c"]);

function norm(v:unknown){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()}
function nameKey(v:unknown){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim()}
function mat(v:unknown){const x=String(v??"").toUpperCase().replace(/\s+/g,"").trim();return x||null}
function compatible(a:string,b:string){return !!a&&!!b&&(a===b||a.includes(b)||b.includes(a))}
function authorized(raw:string){if(!raw)return false;const a=createHash("sha256").update(raw).digest(),b=Buffer.from(TOKEN_HASH,"hex");return a.length===b.length&&timingSafeEqual(a,b)}
function decodeData(raw:string){const b64=raw.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-raw.length%4)%4);return JSON.parse(gunzipSync(Buffer.from(b64,"base64")).toString("utf8"))}

export async function GET(req:NextRequest){
  try{
    const u=req.nextUrl,token=u.searchParams.get("token")||"";if(!authorized(token))return NextResponse.json({error:"unauthorized"},{status:401});
    const mode=u.searchParams.get("mode")==="commit"?"commit":"dry_run",classCode=String(u.searchParams.get("class")||"");
    if(!ALLOWED.has(classCode))return NextResponse.json({error:"class_not_allowed"},{status:400});
    const raw=u.searchParams.get("data")||"";if(!raw)return NextResponse.json({error:"missing_data"},{status:400});
    const input=decodeData(raw);if(!Array.isArray(input)||!input.length||input.length>60)return NextResponse.json({error:"invalid_data"},{status:400});
    if(input.some((r:any)=>String(r.class_code||"")!==classCode))return NextResponse.json({error:"mixed_or_wrong_class"},{status:400});
    const db=getSupabaseServiceClient();
    const {data:classes,error:ce}=await db.from("classes").select("id,code,label,level,academic_year,official_track_code").eq("institution_id",INST_ID);
    if(ce)return NextResponse.json({error:ce.message,stage:"classes"},{status:400});
    const classByCode=new Map<string,any>(),classById=new Map<string,any>();for(const c of classes||[]){classById.set(String(c.id),c);if(String(c.academic_year)===YEAR)classByCode.set(String(c.code),c)}
    const target=classByCode.get(classCode);if(!target)return NextResponse.json({error:"target_class_missing"},{status:400});
    const {data:students,error:se}=await db.from("students").select("id,matricule,last_name,first_name,is_boarder,is_affecte,lv2,lifecycle_status").eq("institution_id",INST_ID);
    if(se)return NextResponse.json({error:se.message,stage:"students"},{status:400});
    const byMat=new Map<string,any>(),byName=new Map<string,any[]>(),near=new Map<string,any[]>();
    for(const s of students||[]){const m=mat(s.matricule);if(m)byMat.set(m,s);const nk=norm(`${s.last_name||""} ${s.first_name||""}`);if(nk){const a=byName.get(nk)||[];a.push(s);byName.set(nk,a)}const lk=norm(s.last_name),ft=norm(s.first_name).split(" ")[0]||"";if(lk&&ft){const k=`${lk}|${ft}`,a=near.get(k)||[];a.push(s);near.set(k,a)}}
    const {data:active,error:ae}=await db.from("class_enrollments").select("id,student_id,class_id,start_date,end_date").eq("institution_id",INST_ID).is("end_date",null);if(ae)return NextResponse.json({error:ae.message,stage:"active"},{status:400});
    const activeByStudent=new Map<string,any>();for(const e of active||[])activeByStudent.set(String(e.student_id),e);
    const {data:profiles,error:pe}=await db.from("student_year_profiles").select("id,student_id,class_id,level,is_boarder,boarding_status_raw,affectation_status,affectation_status_raw,billing_affectation_group,scholarship_status,guardian_phone,source,source_payload,notes").eq("institution_id",INST_ID).eq("academic_year_id",YEAR_ID);if(pe)return NextResponse.json({error:pe.message,stage:"profiles"},{status:400});
    const profileByStudent=new Map<string,any>();for(const p of profiles||[])profileByStudent.set(String(p.student_id),p);
    const counts=new Map<string,number>();for(const r of input){const m=mat(r.matricule);if(m)counts.set(m,(counts.get(m)||0)+1)}
    const issues:any[]=[],plan:any[]=[];let created=0,enriched=0,classChanged=0,alreadyCorrect=0,profilesUpdated=0,skipped=0;
    const fail=(r:any,reason:string,detail?:string)=>{skipped++;issues.push({source:r.source||null,matricule:mat(r.matricule),name:`${r.last_name||""} ${r.first_name||""}`.trim(),reason,detail})};
    for(const r of input){
      const m=mat(r.matricule),inputName=norm(`${r.last_name||""} ${r.first_name||""}`),nearKey=`${norm(r.last_name)}|${norm(r.first_name).split(" ")[0]||""}`;
      if(!m){fail(r,"missing_matricule");continue}if((counts.get(m)||0)>1){fail(r,"duplicate_matricule_in_input");continue}if(!inputName){fail(r,"missing_name");continue}
      let student=byMat.get(m)||null,resolution="matricule",fillMat=false;
      if(student){const dbName=norm(`${student.last_name||""} ${student.first_name||""}`);if(!compatible(dbName,inputName)){fail(r,"matricule_name_conflict",`${student.last_name||""} ${student.first_name||""}`.trim());continue}}
      else{const exact=byName.get(inputName)||[];if(exact.length>1){fail(r,"ambiguous_exact_name",`${exact.length} matches`);continue}if(exact.length===1){const c=exact[0],em=mat(c.matricule);if(em&&em!==m){fail(r,"name_matches_different_matricule",em);continue}student=c;resolution="unique_exact_name";fillMat=!em}else{const similar=near.get(nearKey)||[];if(similar.length){fail(r,"possible_existing_student_similar_name",`${similar.length} similar`);continue}resolution="new"}}
      if(student){if(String(student.lifecycle_status||"active")!=="active"){fail(r,"student_not_active",String(student.lifecycle_status||""));continue}const old=activeByStudent.get(String(student.id));if(old){const ac=classById.get(String(old.class_id)),oldCode=String(ac?.code||"");if(PROTECTED.has(oldCode)){fail(r,"protected_6e_or_seconde",oldCode);continue}}}
      const old=student?activeByStudent.get(String(student.id)):null,oldCode=old?String(classById.get(String(old.class_id))?.code||""):null;plan.push({source:r.source,matricule:m,resolution,active_class:oldCode,planned:student?(oldCode===classCode?"enrich_only":"enrich_and_reassign"):"create_and_assign"});
      if(mode==="dry_run")continue;
      if(!student){const full=`${r.last_name||""} ${r.first_name||""}`.trim(),row:any={institution_id:INST_ID,matricule:m,last_name:String(r.last_name||"").trim(),first_name:String(r.first_name||"").trim(),full_name:full,full_name_key:nameKey(full),lifecycle_status:"active"};if(typeof r.is_boarder==="boolean")row.is_boarder=r.is_boarder;if(r.affectation_status==="affecte"||r.affectation_status==="reaffecte")row.is_affecte=true;if(r.affectation_status==="non_affecte")row.is_affecte=false;if(r.lv2==="ESP"||r.lv2==="ALL")row.lv2=r.lv2;const {data:ins,error:ie}=await db.from("students").insert(row).select("id,matricule,last_name,first_name,is_boarder,is_affecte,lv2,lifecycle_status").single();if(ie||!ins){fail(r,"insert_failed",ie?.message);continue}student=ins;created++;byMat.set(m,student)}
      else{const patch:any={};if(fillMat)patch.matricule=m;if(typeof r.is_boarder==="boolean")patch.is_boarder=r.is_boarder;if(r.affectation_status==="affecte"||r.affectation_status==="reaffecte")patch.is_affecte=true;if(r.affectation_status==="non_affecte")patch.is_affecte=false;if(r.lv2==="ESP"||r.lv2==="ALL")patch.lv2=r.lv2;if(Object.keys(patch).length){const {error:ue}=await db.from("students").update(patch).eq("id",student.id);if(ue){fail(r,"student_update_failed",ue.message);continue}enriched++}}
      const sid=String(student.id),current=activeByStudent.get(sid)||null;if(current&&String(current.class_id)===String(target.id))alreadyCorrect++;else{if(current){const end=String(current.start_date||START_DATE)>START_DATE?String(current.start_date):START_DATE;const {error:xe}=await db.from("class_enrollments").update({end_date:end}).eq("id",current.id);if(xe){fail(r,"close_previous_enrollment_failed",xe.message);continue}}const {data:prior,error:le}=await db.from("class_enrollments").select("id,student_id,class_id,start_date,end_date").eq("institution_id",INST_ID).eq("student_id",sid).eq("class_id",target.id).maybeSingle();if(le){if(current)await db.from("class_enrollments").update({end_date:null}).eq("id",current.id);fail(r,"target_enrollment_lookup_failed",le.message);continue}let next:any=null;if(prior?.id){const {data:re,error:ree}=await db.from("class_enrollments").update({end_date:null}).eq("id",prior.id).select("id,student_id,class_id,start_date,end_date").single();if(ree||!re){if(current)await db.from("class_enrollments").update({end_date:null}).eq("id",current.id);fail(r,"reactivate_failed",ree?.message);continue}next=re}else{const {data:ne,error:ee}=await db.from("class_enrollments").insert({institution_id:INST_ID,student_id:sid,class_id:target.id,start_date:START_DATE,end_date:null,official_track_code:target.official_track_code||null}).select("id,student_id,class_id,start_date,end_date").single();if(ee||!ne){if(current)await db.from("class_enrollments").update({end_date:null}).eq("id",current.id);fail(r,"enrollment_insert_failed",ee?.message);continue}next=ne}activeByStudent.set(sid,next);classChanged++}
      const ep=profileByStudent.get(sid)||{},aff=String(r.affectation_status||ep.affectation_status||"unknown"),billing=aff==="transfere"?"transfere":(aff==="affecte"||aff==="reaffecte")?"affecte":aff==="non_affecte"?"non_affecte":String(ep.billing_affectation_group||"unknown"),ib=typeof r.is_boarder==="boolean"?r.is_boarder:(typeof ep.is_boarder==="boolean"?ep.is_boarder:Boolean(student.is_boarder));
      const prow:any={institution_id:INST_ID,academic_year_id:YEAR_ID,academic_year:YEAR,student_id:sid,class_id:target.id,level:target.level||classCode,is_boarder:ib,boarding_status_raw:r.is_boarder===true?"interne":(ep.boarding_status_raw||null),affectation_status:aff,affectation_status_raw:r.affectation_status||ep.affectation_status_raw||null,billing_affectation_group:billing,scholarship_status:ep.scholarship_status||"unknown",guardian_phone:ep.guardian_phone||null,source:"xlsx_csca_20260827",source_payload:{...(ep.source_payload||{}),source:r.source||null},notes:ep.notes||null};const {data:pu,error:pue}=await db.from("student_year_profiles").upsert(prow,{onConflict:"institution_id,academic_year_id,student_id"}).select("id").single();if(pue||!pu){fail(r,"year_profile_upsert_failed",pue?.message);continue}profileByStudent.set(sid,{...ep,...prow,id:pu.id});profilesUpdated++
    }
    const plannedCounts=plan.reduce((a:any,x:any)=>(a[x.planned]=(a[x.planned]||0)+1,a),{}),resolutionCounts=plan.reduce((a:any,x:any)=>(a[x.resolution]=(a[x.resolution]||0)+1,a),{});return NextResponse.json({mode,class_code:classCode,input_rows:input.length,summary:{created,enriched,classChanged,alreadyCorrect,profilesUpdated,skipped,issues:issues.length,planned:plan.length,plannedCounts,resolutionCounts},issues});
  }catch(e:any){return NextResponse.json({error:String(e?.message||e),stage:"unexpected"},{status:500})}
}
