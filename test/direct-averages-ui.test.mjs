import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Window } from 'happy-dom';
const require=createRequire(import.meta.url);
test('Écran de saisie directe : chargement, décimales, sauvegarde, erreur et annulation',async()=>{
 const window=new Window({url:'https://fixture.test/admin/notes/statistiques'});
 const keys=['window','document','navigator','HTMLElement','HTMLInputElement','Event','IS_REACT_ACT_ENVIRONMENT'];
 const previous=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='window'?window:window[key]});
 const React=await import('react');const {createRoot}=await import('react-dom/client');
 const compiled=await require('esbuild').build({entryPoints:['src/components/admin/DirectSubjectAverages.tsx'],bundle:true,write:false,jsx:'automatic',platform:'node',format:'cjs',external:['react','react/jsx-runtime']});
 const loaded={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,loaded,loaded.exports);
 const Component=loaded.exports.default;let dirty=false,saving=false,fail=false;const posts=[];
 const originalFetch=globalThis.fetch;globalThis.fetch=async(_url,options={})=>{
  if(options.method==='POST'){posts.push(JSON.parse(options.body));return Response.json(fail?{ok:false,error:'Connexion interrompue',saved:[]}:{ok:true,saved:posts.at(-1).items.map(row=>row.student_id)},{status:fail?500:200});}
  return Response.json({ok:true,items:[{student_id:'one',full_name:'KOFFI Marie',matricule:'A01',average:null},{student_id:'two',full_name:'YAO Jean',matricule:'A02',average:0}]});
 };
 const host=window.document.createElement('div');window.document.body.append(host);const root=createRoot(host);
 const click=async text=>{const button=[...host.querySelectorAll('button')].find(node=>node.textContent===text);assert.ok(button,text);await React.act(async()=>button.click());};
 const fill=async value=>{const input=host.querySelector('input');await React.act(async()=>{
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);
  input.dispatchEvent(new window.Event('input',{bubbles:true}));
 });};
 try{
  await React.act(async()=>root.render(React.createElement(Component,{classId:'class',subjectId:'subject',periodId:'T1',onDirtyChange:value=>{dirty=value;},onSavingChange:value=>{saving=value;}})));
  assert.equal(host.querySelectorAll('tbody tr').length,2);assert.equal(host.querySelectorAll('input')[1].value,'0');
  await fill('12,50');assert.equal(dirty,true);await click('Enregistrer les moyennes');assert.equal(posts[0].items[0].average,12.5);assert.equal(dirty,false);assert.equal(saving,false);assert.match(host.textContent,/Moyennes enregistrées/);
  await fill('22');await click('Enregistrer les moyennes');assert.equal(posts.length,1);assert.match(host.textContent,/comprises entre 0 et 20/);
  await click('Annuler les modifications');assert.equal(host.querySelector('input').value,'12,5');assert.equal(dirty,false);
  fail=true;await fill('14');await click('Enregistrer les moyennes');assert.equal(dirty,true);assert.equal(host.querySelector('input').value,'14');assert.match(host.textContent,/Connexion interrompue/);
  await click('Annuler les modifications');assert.equal(dirty,false);
  fail=false;await fill('');await click('Enregistrer les moyennes');assert.equal(posts.at(-1).items[0].average,null);assert.equal(dirty,false);
 }finally{
  await React.act(async()=>root.unmount());globalThis.fetch=originalFetch;
  for(const key of keys){if(previous[key])Object.defineProperty(globalThis,key,previous[key]);else delete globalThis[key];}
  await window.happyDOM.close();
 }
});
