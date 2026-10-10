import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { parentConnectStatus, hasParentConnectRole, PARENT_CONNECT_READ_ROLES, PARENT_CONNECT_WRITE_ROLES, PARENT_CONNECT_SETTINGS_ROLES, parentConnectEndLabel } from '../src/lib/parent-connect/domain';
import { getParentConnectStatuses, parentConnectDenial, filterParentConnectNotifications, filterParentConnectQueue } from '../src/lib/parent-connect/server';

const school='10000000-0000-0000-0000-000000000001';
const legacySchool='10000000-0000-0000-0000-000000000002';
const active='20000000-0000-0000-0000-000000000001';
const inactive='20000000-0000-0000-0000-000000000002';
const legacy='20000000-0000-0000-0000-000000000003';
const parentA='30000000-0000-0000-0000-000000000001';
const parentB='30000000-0000-0000-0000-000000000002';
const future = new Date(Date.now()+86400_000).toISOString();
const fixtures: Record<string, any[]> = {
 students: [{id:active,institution_id:school},{id:inactive,institution_id:school},{id:legacy,institution_id:legacySchool}],
 parent_connect_school_settings:[{institution_id:school,enforcement_enabled:true,approved_academic_year:'2026-2027',approved_ends_at:future}],
 parent_connect_accounts:[{student_id:active,institution_id:school,academic_year:'2026-2027',ends_at:future}],
 academic_years:[{institution_id:school,code:'2026-2027',end_date:future.slice(0,10),is_current:true}],
 user_roles: [], parent_devices: [],
 student_guardians:[{id:'g1',student_id:active,parent_id:parentA,guardian_profile_id:null},{id:'g2',student_id:inactive,parent_id:parentB,guardian_profile_id:null}],
};
function service(failure?: {table:string;code:string}, lookup?: any) {
 const calls:string[]=[];
 const client=createClient('https://supabase.test','fake-service-key',{global:{fetch:async(input:any,init?:any)=>{
  const url=new URL(String(input));const table=url.pathname.split('/').at(-1)!;calls.push(table);
  if (table===failure?.table) return new Response(JSON.stringify({code:failure.code,message:'simulated failure'}),{status:500,headers:{'Content-Type':'application/json'}});
  if (table==='parent_connect_access_status') return new Response(JSON.stringify(lookup === undefined ? {enforced:true,ends_at:null} : lookup),{headers:{'Content-Type':'application/json'}});
  let rows=[...(fixtures[table]||[])];
  for(const [key,value] of url.searchParams) {
   if(value.startsWith('eq.')) rows=rows.filter(r=>String(r[key])===value.slice(3));
   if(value.startsWith('in.(')) {const ids=value.slice(4,-1).split(',');rows=rows.filter(r=>ids.includes(String(r[key])));}
  }
  const accept=new Headers(init?.headers).get('accept')||'';
  return new Response(JSON.stringify(accept.includes('object') ? rows[0] || null : rows),{headers:{'Content-Type':'application/json'}});
 }} });return {client,calls};
}

test('expiration exacte et fin scolaire : un matricule actif ouvre, un expiré ferme',()=>{
 const now=Date.parse('2026-10-10T03:00:00Z');
 assert.equal(parentConnectStatus(true,'2026-10-10T03:00:00Z',now).allowed,false);
 assert.equal(parentConnectStatus(true,'2026-10-10T03:00:01Z',now).allowed,true);
 assert.equal(parentConnectStatus(true,null,now).status,'inactive');
 assert.equal(parentConnectStatus(false,null,now).allowed,true);
});
test('les trois rôles consultent, seuls admin/finance/fondateur encaissent',()=>{
 for(const role of ['admin','finance_manager','file_correspondent']) assert.equal(hasParentConnectRole([role],PARENT_CONNECT_READ_ROLES),true);
 assert.equal(hasParentConnectRole(['file_correspondent'],PARENT_CONNECT_WRITE_ROLES),false);
 assert.equal(hasParentConnectRole(['teacher'],PARENT_CONNECT_READ_ROLES),false);
});
test('une famille mixte ne débloque pas un enfant non abonné',async()=>{
 const {client}=service();const statuses=await getParentConnectStatuses(client,fixtures.students);
 assert.equal(statuses.get(active)?.allowed,true);assert.equal(statuses.get(inactive)?.allowed,false);assert.equal(statuses.get(legacy)?.allowed,true);
});
test('absence de migration préserve les écoles ; panne réseau ferme l’accès',async()=>{
 const before=service({table:'parent_connect_school_settings',code:'PGRST205'});
 assert.equal((await getParentConnectStatuses(before.client,fixtures.students)).get(inactive)?.allowed,true);
 const outage=service({table:'parent_connect_school_settings',code:'57014'});
 await assert.rejects(getParentConnectStatuses(outage.client,fixtures.students));
});
test('une ancienne session est bloquée côté serveur en une seule requête',async()=>{
 const {client,calls}=service();const denied=await parentConnectDenial(client,inactive);
 assert.equal(denied?.status,402);assert.equal((await denied!.json()).code,'PARENT_CONNECT_REQUIRED');
 assert.deepEqual(calls,['parent_connect_access_status']);
 assert.equal(await parentConnectDenial(service(undefined,{enforced:true,ends_at:future}).client,active),null);
 const outage=service({table:'parent_connect_access_status',code:'57014'});
 assert.equal((await parentConnectDenial(outage.client,active))?.status,503);
});
test('les notes/alertes de l’enfant non abonné sont filtrées séparément',async()=>{
 const {client}=service();const rows=[{id:'a',student_id:active,institution_id:school},{id:'b',student_id:inactive,institution_id:school}];
 assert.deepEqual((await filterParentConnectNotifications(client,rows,[active,inactive])).map(r=>r.id),['a']);
});
test('un payload historique en texte JSON ne contourne pas le contrôle par enfant',async()=>{
 const {client}=service();const rows=[
  {id:'paid',parent_id:parentA,institution_id:school,payload:JSON.stringify({student_id:active})},
  {id:'unpaid',parent_id:parentA,institution_id:school,payload:JSON.stringify({studentId:inactive})},
 ];
 assert.deepEqual((await filterParentConnectNotifications(client,rows,[active,inactive])).map(r=>r.id),['paid']);
});
test('push et SMS : préserver les admins et ne pas confondre deux familles',async()=>{
 const {client,calls}=service();const rows=[
  {id:'a',parent_id:parentA,institution_id:school,payload:{kind:'communication'}},
  {id:'b',parent_id:parentB,institution_id:school,payload:{kind:'communication'}},
  {id:'c',student_id:inactive,institution_id:school,payload:{kind:'attendance'}},
  {id:'d',student_id:inactive,profile_id:'staff',institution_id:school,payload:{kind:'admin_attendance_alert'}},
  {id:'e',student_id:inactive,profile_id:'founder',institution_id:school,payload:{kind:'founder_finance_receipt'}},
  {id:'f',student_id:inactive,profile_id:'founder',institution_id:school,payload:JSON.stringify({kind:'founder_finance_receipt'})},
 ];
 assert.deepEqual((await filterParentConnectQueue(client,rows)).map(r=>r.id),['a','d','e','f']);
 assert.ok(calls.length<10,'les notifications génériques doivent être contrôlées en lot');
});

test('la date affichée inclut le dernier jour scolaire, sans afficher le lendemain',()=>{assert.equal(parentConnectEndLabel('2027-07-12T00:00:00Z'),'11/07/2027');});
test('seul le super admin peut changer les restrictions et accorder des crédits',()=>{assert.equal(hasParentConnectRole(['admin'],PARENT_CONNECT_SETTINGS_ROLES),false);assert.equal(hasParentConnectRole(['founder'],PARENT_CONNECT_SETTINGS_ROLES),false);assert.equal(hasParentConnectRole(['super_admin'],PARENT_CONNECT_SETTINGS_ROLES),true);});
test('notification en lot : aucun accès avec une autre année ou sans période approuvée',async()=>{
 const previous=fixtures.academic_years[0].code; fixtures.academic_years[0].code='2027-2028';
 try{assert.equal((await getParentConnectStatuses(service().client,fixtures.students)).get(active)?.allowed,false);}finally{fixtures.academic_years[0].code=previous;}
 const approved=fixtures.parent_connect_school_settings[0].approved_ends_at;fixtures.parent_connect_school_settings[0].approved_ends_at=null;
 try{assert.equal((await getParentConnectStatuses(service().client,fixtures.students)).get(active)?.allowed,false);}finally{fixtures.parent_connect_school_settings[0].approved_ends_at=approved;}
});
