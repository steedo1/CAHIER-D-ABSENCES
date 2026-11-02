import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('src/lib/supabaseAdmin.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('separate Next bundles share one stateless service client and reference cache',()=>{
 let clients=0,caches=0;const shared={};
 const deps={
  './supabase-reference-fetch':{createReferenceFetch:()=>{caches++;return()=>{};}},
  '@supabase/supabase-js':{createClient:(url,key,options)=>{
   clients++;assert.equal(url,'https://synthetic.invalid');assert.equal(key,'synthetic');
   assert.equal(options.auth.autoRefreshToken,false);assert.equal(options.auth.persistSession,false);return {synthetic:true};
  }},
 };
 function bundle(){const m={exports:{}};new Function('require','module','exports','process','globalThis',code)(name=>deps[name],m,m.exports,{env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic'}},shared);return m.exports;}
 const a=bundle(),b=bundle();assert.equal(a.getSupabaseServiceClient(),b.getSupabaseServiceClient());
 assert.equal(clients,1);assert.equal(caches,1);
});
