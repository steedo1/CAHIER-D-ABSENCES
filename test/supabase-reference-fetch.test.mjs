import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/lib/supabase-reference-fetch.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};new Function('module','exports',code)(module,module.exports);
const {createReferenceFetch}=module.exports;
const classes='https://project.supabase.co/rest/v1/classes?select=id,label&institution_id=eq.school-a';
test('20 lectures de référence concurrentes partagent une requête, avec réponses indépendantes',async()=>{
 let count=0;const fetcher=createReferenceFetch(async()=>{count++;await new Promise(r=>setTimeout(r,5));return Response.json([{id:'class-a'}])});
 const responses=await Promise.all(Array.from({length:20},()=>fetcher(classes)));
 assert.equal(count,1);for(const response of responses)assert.deepEqual(await response.json(),[{id:'class-a'}]);
 await fetcher(classes);assert.equal(count,1);
 await fetcher(classes.replace('school-a','school-b'));assert.equal(count,2);
});
test('une écriture invalide les données et une réponse en erreur ne remplit pas le cache',async()=>{
 let count=0;const fetcher=createReferenceFetch(async(_input,init)=>{count++;return init?.method==='PATCH'?new Response(null,{status:204}):Response.json({count})});
 await fetcher(classes);await fetcher(classes);assert.equal(count,1);
 await fetcher(classes,{method:'PATCH'});assert.deepEqual(await (await fetcher(classes)).json(),{count:3});
 let errors=0;const failing=createReferenceFetch(async()=>{errors++;return new Response('error',{status:400})});await failing(classes);await failing(classes);assert.equal(errors,2);
});
test('profils, rôles, QR et requêtes annulables conservent leurs vérifications réseau',async()=>{
 let count=0;const fetcher=createReferenceFetch(async()=>{count++;return Response.json({})});
 for(const table of ['profiles','user_roles','bulletin_qr_codes']){const url=classes.replace('/classes?','/'+table+'?');await fetcher(url);await fetcher(url)}
 assert.equal(count,6);await fetcher(classes,{signal:new AbortController().signal});await fetcher(classes,{signal:new AbortController().signal});assert.equal(count,8);
});
test('un chargement antérieur à une écriture ne peut pas repeupler le cache',async()=>{
 let release;let reads=0;const fetcher=createReferenceFetch(async(_url,init)=>{if(init?.method==='PATCH')return new Response(null,{status:204});reads++;if(reads===1)await new Promise(r=>{release=r});return Response.json({reads})});
 const old=fetcher(classes);await new Promise(r=>setTimeout(r,0));await fetcher(classes,{method:'PATCH'});release();await old;await fetcher(classes);assert.equal(reads,2);
});
