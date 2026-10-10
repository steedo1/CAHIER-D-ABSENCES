import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import pathModule from 'node:path';
const require=createRequire(import.meta.url);
function load(path,overrides={}) {
 const code=ts.transpileModule(fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',code)(id=>{
  if(id in overrides)return overrides[id];
  if(id.startsWith('.'))return load(pathModule.posix.normalize(pathModule.posix.join(pathModule.posix.dirname(path),id))+'.ts',overrides);
  if(id.startsWith('@/lib/'))return load(`src/lib/${id.slice(6)}.ts`,overrides);
  return require(id);
 },mod,mod.exports);return mod.exports;
}
const {createClient}=require('@supabase/supabase-js');
const school='10000000-0000-0000-0000-000000000001',student='20000000-0000-0000-0000-000000000001';
const actor='30000000-0000-0000-0000-000000000001',op='40000000-0000-0000-0000-000000000001';
const phone='+2250700000000',end='2027-07-12T00:00:00Z';
const {parentConnectPhone}=load('src/lib/parent-connect/phone.ts');
await test('numéro ivoirien : zéro conservé, formats normalisés, texte et numéro invalide refusés',()=>{
 for(const n of ['07 00 00 00 00','+2250700000000','00225 07 00 00 00 00'])assert.equal(parentConnectPhone(n),phone);
 for(const n of ['bonjour 0700000000','123','+225700000000',null,''])assert.equal(parentConnectPhone(n),null);
});
function setup({premium=true,event='absent',eventEnabled=true,active=true,phonePresent=true,lookupFails=false,registered=false,smsInsertFails=false}={}) {
 const calls=[],sends=[];
 const payload=event==='notes_digest'?{kind:'notes_digest',student:{id:student,name:'KOUADIO ANGE'},items:[{subject:'Math',score:17,scale:20}],title:'Notes',body:'Math 17/20'}:{kind:'attendance',event,student:{id:student,name:'KOUADIO ANGE'},class:{label:'6ème A'},session:{started_at:'2026-10-10T08:00:00Z'}};
 const queue={id:op,institution_id:school,student_id:student,parent_id:null,profile_id:null,channels:['sms'],payload,title:'Suivi',body:'Suivi de votre enfant',status:'pending',attempts:0,created_at:'2026-10-10T08:00:00Z',meta:{source:event==='notes_digest'?'notes_digest':'parent_connect_attendance_sms'}};
 const srv=createClient('https://supabase.test','test-key',{global:{fetch:async(input,init={})=>{
  const u=new URL(String(input)),table=u.pathname.split('/').at(-1),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({table,method,body,url:u});
  if(table==='parent_connect_sms_contacts')return lookupFails?Response.json({code:'57014',message:'Unavailable'},{status:500}):Response.json(phonePresent&&active?[{student_id:student,phone_e164:phone}]:[]);
  if(method!=='GET'){
   if(smsInsertFails&&table==='notifications_queue'&&method==='POST'&&(Array.isArray(body)?body[0]:body)?.channels?.includes('sms'))return Response.json({code:'23514',message:'SMS rejected'},{status:400});
   return Response.json(table==='notifications_queue'?[queue]:null,{headers:{'content-range':'0-0/1'}});
  }
  const data={
   notifications_queue:[queue],students:[{id:student,institution_id:school,first_name:'ANGE',last_name:'KOUADIO'}],
   parent_connect_school_settings:[{institution_id:school,enforcement_enabled:true,approved_academic_year:'2026-2027',approved_ends_at:end}],
   academic_years:[{institution_id:school,code:'2026-2027',end_date:'2027-07-11'}],
   parent_connect_accounts:active?[{institution_id:school,student_id:student,academic_year:'2026-2027',ends_at:end}]:[],
   student_guardians:registered?[{student_id:student,parent_id:actor,notifications_enabled:true}]:[],
   parent_devices:[],user_roles:[],parent_notification_contacts:[],profiles:[],
   institution_notification_channel_settings:{institution_id:school,push_enabled:true,sms_premium_enabled:premium,sms_provider:'orange_ci',sms_absence_enabled:event==='absent'&&eventEnabled,sms_late_enabled:event==='late'&&eventEnabled,sms_notes_digest_enabled:event==='notes_digest'&&eventEnabled},
   institutions:{name:'CSCA'},
  }[table];
  if(data===undefined)throw Error(`Unexpected ${table}`);
  return Response.json(data);
 }}});
 const overrides={
  '@/lib/supabaseAdmin':{getSupabaseServiceClient:()=>srv},
  '@/lib/sms/orange':{sendOrangeSms:async(input)=>{sends.push(input);return {to:input.to,senderAddress:'tel:+2250000000000',response:{outboundSMSMessageRequest:{resourceURL:'https://orange.test/requests/test-1'}}};}},
 };
 return {srv,calls,sends,route:load('src/app/api/sms/dispatch/route.ts',overrides),notifications:load('src/lib/notifications.ts',overrides)};
}
const request=()=>new Request('https://example.test/api/sms/dispatch',{headers:{'x-cron-secret':'test-only-secret'}});
process.env.CRON_SECRET='test-only-secret';
for(const event of ['absent','late','notes_digest'])await test(`dispatcher ${event} : SMS au numéro souscrit, sans profil parent ni connexion`,async()=>{
 const s=setup({event});const response=await s.route.POST(request());assert.equal(response.status,200);assert.equal(s.sends.length,1);assert.equal(s.sends[0].to,phone);assert.match(s.sends[0].message,/KOUADIO ANGE/);if(event==='notes_digest')assert.match(s.sends[0].message,/17\/20/);
 assert.ok(s.calls.some(c=>c.table==='parent_connect_sms_contacts'&&c.body.p_institution_id===school));
 assert.ok(!s.calls.some(c=>c.table==='parent_notification_contacts'));
 const update=s.calls.find(c=>c.table==='notifications_queue'&&c.method==='PATCH');assert.equal(update.body.status,'sent');assert.equal(update.body.meta.sms_dispatch.success_targets[0].profile_id,null);
 const outbox=s.calls.find(c=>c.table==='orange_sms_outbox');assert.equal(outbox.body.contact_id,null);assert.equal(outbox.body.profile_id,null);
});
for(const options of [{premium:false},{eventEnabled:false},{active:false},{phonePresent:false},{lookupFails:true}])await test(`aucun SMS sans autorisation, abonnement ou numéro : ${JSON.stringify(options)}`,async()=>{
 const s=setup(options);await s.route.POST(request());assert.equal(s.sends.length,0);
 assert.ok(!s.calls.some(c=>c.table==='institution_notification_channel_settings'&&c.method!=='GET'));
});
const adminOptions=(srv)=>({srv,institution_id:school,admin_call_id:op,class_label:'6ème A',items:[{student_id:student,status:'absent'}],whenIso:'2026-10-10T08:00:00Z'});
await test('appel admin sans compte parent : SMS seul, jamais de push fabriqué',async()=>{
 const s=setup();await s.notifications.queueAdminAttendanceNotifications(adminOptions(s.srv));
 const rows=s.calls.filter(c=>c.table==='notifications_queue'&&c.method==='POST').flatMap(c=>c.body);assert.equal(rows.length,1);assert.deepEqual(rows[0].channels,['sms']);assert.equal(rows[0].student_id,student);assert.equal(rows[0].parent_id,undefined);
});
await test('CSCA SMS off : aucun SMS, push et contenu parent existants conservés',async()=>{
 const s=setup({premium:false,registered:true});await s.notifications.queueAdminAttendanceNotifications(adminOptions(s.srv));
 const rows=s.calls.filter(c=>c.table==='notifications_queue'&&c.method==='POST').flatMap(c=>c.body);assert.equal(rows.length,1);assert.deepEqual(rows[0].channels,['inapp','push']);assert.equal(rows[0].parent_id,actor);assert.equal(rows[0].payload.kind,'attendance');
});
await test('panne numéro ou insertion SMS : push enregistrés dans leur transaction séparée',async()=>{
 for(const options of [{lookupFails:true},{smsInsertFails:true}]){
  const s=setup({...options,registered:true});const result=await s.notifications.queueAdminAttendanceNotifications(adminOptions(s.srv));assert.equal(result.queued,1);
  const writes=s.calls.filter(c=>c.table==='notifications_queue'&&c.method==='POST');assert.deepEqual(writes[0].body[0].channels,['inapp','push']);
 }
});
await test('API encaissement : numéro exigé, normalisé et acteur/établissement vérifiés',async()=>{
 const calls=[];const access={srv:{rpc:async(name,body)=>{calls.push({name,body});return {data:{},error:null};}},institutionId:school,user:{id:actor}};
 const route=load('src/app/api/admin/parent-connect/route.ts',{'../_helpers/institutionAccess':{requireInstitutionAccess:async()=>access}});
 const body={operation_id:op,student_id:student,academic_year:'2026-2027',payer_name:'Parent Ange',payment_method:'cash'};
 const req=(body)=>new (require('next/server').NextRequest)('https://example.test/api/admin/parent-connect',{method:'POST',body:JSON.stringify(body)});
 assert.equal((await route.POST(req(body))).status,400);assert.equal(calls.length,0);
 assert.equal((await route.POST(req({...body,sms_phone:'07 00 00 00 00',institution_id:'forged',actor_id:'forged'}))).status,200);
 assert.equal(calls[0].body.p_sms_phone_e164,phone);assert.equal(calls[0].body.p_institution_id,school);assert.equal(calls[0].body.p_actor_id,actor);
 assert.equal((await route.POST(req({...body,action:'phone',sms_phone:phone,expected_phone:null}))).status,200);assert.equal(calls[1].name,'parent_connect_set_phone');
});

await test('dispatcher : en-tête cron forgé ou secret absent/refusé, aucun accès base ni SMS',async()=>{
 const s=setup();
 for(const headers of [{},{'x-vercel-cron':'1'},{'x-cron-secret':'wrong'}])assert.equal((await s.route.POST(new Request('https://example.test/api/sms/dispatch',{headers}))).status,403);
 assert.equal(s.calls.length,0);assert.equal(s.sends.length,0);
});
