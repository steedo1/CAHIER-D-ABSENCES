// Isolated synthetic workload, never connects to Supabase. Run each version in
// a fresh process: node --expose-gc scripts/measure-reference-cache-memory.mjs [baseline|working]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const label=process.argv[2] || 'working';
const source=label==='baseline'
  ? execFileSync('git',['show','98f121f342693ee47a11d4aeb5e4924199ed8a5d:src/lib/supabase-reference-fetch.ts'],{encoding:'utf8'})
  : readFileSync(new URL('../src/lib/supabase-reference-fetch.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};new Function('module','exports',compiled)(mod,mod.exports);
const fetcher=mod.exports.createReferenceFetch(async()=>new Response('x'.repeat(1024*1024)));
for(let i=0;i<200;i++){
 const url=`https://synthetic.invalid/rest/v1/institutions?select=id,name&institution_id=eq.synthetic-${i}`;
 await (await fetcher(url)).arrayBuffer();
}
for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,20));global.gc?.();}
console.log(JSON.stringify({label,entriesRequested:200,responseMiB:1,MiB:Object.fromEntries(Object.entries(process.memoryUsage()).map(([k,v])=>[k,Math.round(v/1048576*10)/10]))}));
// Keep the cache reachable through the measurement, including across forced GC.
await fetcher('https://synthetic.invalid/rest/v1/institutions?select=id,name&institution_id=eq.synthetic-199');
