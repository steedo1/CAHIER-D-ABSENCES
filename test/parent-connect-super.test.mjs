import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(relative, overrides={}) {
 const code=ts.transpileModule(fs.readFileSync(new URL(`../${relative}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',code)(id=>{
  if(id in overrides)return overrides[id];
  if(id==='@/lib/parent-connect/domain')return load('src/lib/parent-connect/domain.ts');
  if(id==='@/lib/parent-connect/phone')return load('src/lib/parent-connect/phone.ts');
  if(id==='@/lib/parent-connect/errors')return load('src/lib/parent-connect/errors.ts');
  if(id==='@/lib/parent-connect/super-access')return load('src/lib/parent-connect/super-access.ts',overrides);
  return require(id);
 },mod,mod.exports);return mod.exports;
}
const school='10000000-0000-0000-0000-000000000001', actor='30000000-0000-0000-0000-000000000001', operation='40000000-0000-0000-0000-000000000001';
const {createClient}=require('@supabase/supabase-js');
const {NextRequest}=require('next/server');
function server({role='super_admin',loggedIn=true,rolesFail=false}={}) {
 const calls=[];
 const srv=createClient('https://supabase.test','test-key',{global:{fetch:async(input,init)=>{
  const url=new URL(String(input)),table=url.pathname.split('/').at(-1);const body=init.body?JSON.parse(init.body):null;calls.push({table,body});
  if(table==='user_roles')return Response.json(rolesFail?{code:'57014',message:'failure'}:[{role}],{status:rolesFail?500:200});
  return Response.json({id:body?.p_operation_id,quantity:body?.p_quantity});
 }}});
 const overrides={
  '@/lib/supabase-server':{getSupabaseServerClient:async()=>({}),getVerifiedServerUser:async()=>({data:{user:loggedIn?{id:actor,user_metadata:{role:'super_admin'}}:null}})},
  '@/lib/supabaseAdmin':{getSupabaseServiceClient:()=>srv},
 };
 return {route:load('src/app/api/super/parent-connect/route.ts',overrides),calls};
}
const body={action:'grant',institution_id:school,operation_id:operation,academic_year:'2026-2027',quantity:2,reference:'Banque vérifiée',confirm_received:true};
const req=(data)=>new NextRequest('https://example.test/api/super/parent-connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
await test('API super : utilisateur anonyme, admin et financier ne peuvent créer de crédits',async()=>{
 for(const options of [{loggedIn:false},{role:'admin'},{role:'finance_manager'},{role:'file_correspondent'}]) {
  const s=server(options);const r=await s.route.POST(req(body));assert.equal(r.status,options.loggedIn===false?401:403);assert.ok(!s.calls.some(c=>c.table==='parent_connect_grant_credits'));
 }
});
await test('API super : refus d’une panne de vérification, sans faire confiance aux métadonnées',async()=>{
 const s=server({rolesFail:true});assert.equal((await s.route.POST(req(body))).status,503);assert.equal(s.calls.length,1);
});
await test('API super : confirmation obligatoire, acteur issu de la session, quantité vérifiée',async()=>{
 const s=server();assert.equal((await s.route.POST(req({...body,confirm_received:false}))).status,400);
 assert.equal((await s.route.POST(req({...body,quantity:1.5}))).status,400);
 assert.equal((await s.route.POST(req({...body,actor_id:'forged'}))).status,200);
 const rpc=s.calls.find(c=>c.table==='parent_connect_grant_credits');assert.equal(rpc.body.p_actor_id,actor);assert.equal(rpc.body.p_quantity,2);assert.equal(rpc.body.p_academic_year,'2026-2027');
});
await test('API super : le collectif transmet le nombre confirmé et ne crée pas de paiements parents',async()=>{
 const s=server();assert.equal((await s.route.POST(req({...body,action:'bulk',expected_count:1003}))).status,200);
 const rpc=s.calls.find(c=>c.table==='parent_connect_bulk_activate');assert.equal(rpc.body.p_expected_count,1003);assert.equal(rpc.body.p_actor_id,actor);assert.ok(!s.calls.some(c=>c.table==='parent_connect_collect'));
});
await test('API admin : impossible de désactiver le contrôle par abonnement',async()=>{
 const route=load('src/app/api/admin/parent-connect/route.ts',{'../_helpers/institutionAccess':{requireInstitutionAccess:async()=>{throw Error('must not be called');}}});
 assert.equal((await route.PATCH()).status,403);
});
const window=new Window({url:'https://example.test/super/parent-connect'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent'])Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:window[name]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const {createRoot}=await import('react-dom/client');const Control=load('src/app/super/parent-connect/Control.tsx').default;
const summary={subscriptions_active:0,credits_available:0,credits_granted:0,credits_used:0,nexa_received:0,pending_remittances:0,school_covered:0};
async function mount({failOnce=false}={}) {
 const calls=[];let fail=failOnce;
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url,window.location.origin),data=init.body?JSON.parse(init.body):null;calls.push(data||{get:u.search});
  if(data){if(fail){fail=false;throw new TypeError('Connexion interrompue');}return Response.json({grant:{quantity:data.quantity},bulk:{activated_count:1234,ends_at:'2027-07-12T00:00:00Z'}});}
  return Response.json(u.searchParams.has('institution_id')?{institution:{id:school,name:'CSCA'},year:{code:'2026-2027',end_date:'2027-07-11'},settings:{enforcement_enabled:false,activations_paused:false},summary,roster:{eligible_count:1234,skipped_no_matricule:2},grants:[],bulk:[],payments:[],remittances:[]}:{items:[{id:school,name:'CSCA',summary}],total:1});
 };
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
 await act(async()=>{root.render(React.createElement(Control));});
 return {container,calls,close:async()=>{await act(async()=>root.unmount());container.remove();}};
}
const button=(ui,text)=>[...ui.container.querySelectorAll('button')].find(b=>b.textContent.includes(text));
const click=async(el)=>{assert.ok(el);await act(async()=>el.click());};
const change=async(el,value)=>act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));el.dispatchEvent(new window.Event('change',{bubbles:true}));});
const submit=async(ui)=>act(async()=>ui.container.querySelector('dialog form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
await test('super admin : collectif CSCA exige référence et confirmation, aucune collecte parent',async()=>{
 const ui=await mount();try{
  await click(button(ui,'Gérer'));await click(button(ui,'Activer tous les élèves'));
  assert.equal(ui.container.querySelector('dialog').open,true);assert.ok(ui.container.querySelector('dialog').textContent.includes('1234'));assert.ok(ui.container.textContent.includes('11/07/2027'));
  assert.equal(button(ui,'Confirmer l’activation collective').disabled,true);await submit(ui);assert.ok(!ui.calls.some(c=>c.action));
  await change(ui.container.querySelector('dialog input[type=text], dialog input:not([type])'),'CSCA déjà réglé');await click(ui.container.querySelector('dialog input[type=checkbox]'));await submit(ui);
  const sent=ui.calls.find(c=>c.action==='bulk');assert.equal(sent.expected_count,1234);assert.equal(sent.academic_year,'2026-2027');assert.equal(sent.confirm_received,true);assert.equal(sent.institution_id,school);assert.ok(!('amount' in sent));assert.ok(ui.container.textContent.includes('1234 élèves couverts'));
 }finally{await ui.close();}
});
await test('super admin : crédits reçus et reprise après coupure gardent la même opération',async()=>{
 const ui=await mount({failOnce:true});try{
  await click(button(ui,'Gérer'));await click(button(ui,'Attribuer des crédits'));await change(ui.container.querySelector('dialog input[type=number]'),'20');await change(ui.container.querySelector('dialog input:not([type])'),'Banque-20');await click(ui.container.querySelector('dialog input[type=checkbox]'));await submit(ui);
  assert.ok(ui.container.textContent.includes('Connexion interrompue'));await submit(ui);
  const sent=ui.calls.filter(c=>c.action==='grant');assert.equal(sent.length,2);assert.equal(sent[0].operation_id,sent[1].operation_id);assert.equal(sent[0].quantity,20);assert.equal(sent[0].confirm_received,true);
 }finally{await ui.close();}
});
await window.happyDOM.abort();
