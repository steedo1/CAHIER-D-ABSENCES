import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";
import * as closer from "../src/lib/attendance-server-close.ts";
const require = createRequire(import.meta.url);
const now = Date.parse("2026-10-22T08:32:00Z");
const row = { id: "session-fixture", institution_id: "school-fixture", started_at: "2026-10-22T07:30:00Z",
  expected_minutes: 60, status: "open", ended_at: null };

test("07 h 30 : la même échéance +2 min s'applique même sans appareil connecté", () => {
  assert.equal(closer.serverAttendanceClosure(row, now - 1), null);
  assert.equal(closer.serverAttendanceClosure(row, now), "2026-10-22T08:32:00.000Z");
  assert.equal(closer.serverAttendanceClosure(row, now + 3600_000), "2026-10-22T08:32:00.000Z");
});
test("ne jamais deviner une durée ou fermer une séance future, ancienne ou terminée", () => {
  for (const patch of [{expected_minutes:null}, {expected_minutes:0}, {expected_minutes:-1}, {expected_minutes:1.5},
    {expected_minutes:1441}, {started_at:"invalid"}, {started_at:"2026-10-23T07:30:00Z"},
    {started_at:"2026-10-10T07:30:00Z"}, {ended_at:"2026-10-22T08:30:00Z"}, {status:"submitted"},
    {institution_id:""}, {id:""}]) assert.equal(closer.serverAttendanceClosure({...row,...patch}, now), null);
});

function database({rows=[row], race=false, readError=false, writeError=false}={}) {
  const calls = [];
  const table = () => {
    const call = { table: "teacher_sessions", filters: [], patch: null, limit: null }; calls.push(call);
    const chain = { select() { return chain; }, update(patch) { call.patch=patch; return chain; },
      eq(...args) { call.filters.push(["eq",...args]); return chain; },
      is(...args) { call.filters.push(["is",...args]); return chain; },
      gte(...args) { call.filters.push(["gte",...args]); return chain; },
      gt(...args) { call.filters.push(["gt",...args]); return chain; },
      lte(...args) { call.filters.push(["lte",...args]); return chain; },
      order() { return chain; }, limit(n) { call.limit=n; return chain; },
      async maybeSingle() { return {data:race?null:{id:row.id}, error:writeError?{message:"fixture"}:null}; },
      then(resolve, reject) { return Promise.resolve({data:rows,error:readError?{message:"fixture"}:null}).then(resolve,reject); },
    }; return chain;
  }; return {calls,table};
}
test("simulation : compter les candidats sans accéder à une écriture", async () => {
  const result = await closer.closeAttendanceBatch({rows:[row],now,apply:false,table:()=>{throw Error("forbidden write");}});
  assert.deepEqual(result,{eligible:1,closed:0,raced:0});
});
test("clôture bornée et conditionnelle : la reprise concurrente ne remplace aucune fin manuelle", async () => {
  const db=database();
  const result=await closer.closeAttendanceBatch({rows:[row],now,apply:true,table:db.table});
  assert.deepEqual(result,{eligible:1,closed:1,raced:0});
  assert.deepEqual(db.calls[0].patch,{ended_at:"2026-10-22T08:32:00.000Z",status:"submitted"});
  for(const filter of [["eq","id",row.id],["eq","institution_id",row.institution_id],
    ["eq","started_at",row.started_at],["eq","expected_minutes",60],["eq","status","open"],["is","ended_at",null]])
    assert.ok(db.calls[0].filters.some(f=>JSON.stringify(f)===JSON.stringify(filter)));
  const raced=database({race:true});
  assert.deepEqual(await closer.closeAttendanceBatch({rows:[row],now,apply:true,table:raced.table}),{eligible:1,closed:0,raced:1});
});
test("lot borné et erreur d'écriture non masquée", async () => {
  const db=database();
  const result=await closer.closeAttendanceBatch({rows:Array(105).fill(row),now,apply:true,table:db.table});
  assert.equal(result.closed,100); assert.equal(db.calls.length,100);
  await assert.rejects(closer.closeAttendanceBatch({rows:[row],now,apply:true,table:database({writeError:true}).table}),/attendance_close_write_failed/);
});

const compiled=ts.transpileModule(readFileSync(new URL("../src/app/api/cron/attendance/close-overdue/route.ts",import.meta.url),"utf8"),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function routeFixture({enabled=false,secret="fixture-secret",...options}={}) {
  const db=database(options); const loaded={exports:{}};
  const imports={"node:crypto":require("node:crypto"),"next/server":require("next/server"),
    "@/lib/supabaseAdmin":{getSupabaseServiceClient:()=>({from(name){assert.equal(name,"teacher_sessions");return db.table();}})},
    "@/lib/attendance-server-close":closer};
  new Function("require","module","exports","process",compiled)(name=>{assert.ok(name in imports);return imports[name];},
    loaded,loaded.exports,{env:{CRON_SECRET:secret,ATTENDANCE_SERVER_CLOSE_ENABLED:enabled?"true":"false"}});
  return {...db,route:loaded.exports,request:(query="",headers={"x-cron-secret":secret})=>new NextRequest("https://www.mon-cahier.com/api/cron/attendance/close-overdue"+query,{method:"POST",headers})};
}
test("route : absence de secret, faux secret et ancien en-tête Vercel sont refusés sans requête", async () => {
  for(const headers of [{},{"x-vercel-cron":"1"},{"x-cron-secret":"wrong"},{"authorization":"fixture-secret"},{"x-cron-secret":"éééééééééééééé"}]) {
    const s=routeFixture(); assert.equal((await s.route.POST(s.request("",headers))).status,403);assert.equal(s.calls.length,0);
  }
  const s=routeFixture({secret:""});assert.equal((await s.route.POST(s.request())).status,403);assert.equal(s.calls.length,0);
});
test("route : une demande d'application ne suffit pas sans activation explicite", async () => {
  const s=routeFixture();const r=await s.route.POST(s.request("?apply=1"));assert.equal(r.status,409);assert.equal(s.calls.length,0);
});
test("route : mode de simulation par défaut, requête de lecture bornée, aucun SMS ni notification", async () => {
  const s=routeFixture({rows:[{...row,started_at:new Date(Date.now()-90*60_000).toISOString()}]});
  const r=await s.route.POST(s.request());const j=await r.json();
  assert.equal(r.status,200);assert.equal(j.ok,true);assert.equal(j.dry_run,true);assert.equal(j.closed,0);assert.equal(j.eligible,1);
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].patch,null);assert.equal(s.calls[0].limit,100);assert.equal(r.headers.get("cache-control"),"no-store");
  assert.ok(s.calls[0].filters.some(f=>f[0]==="gte"&&f[1]==="started_at"));
});
test("route : activation seule reste en simulation ; seul apply=1 autorise la clôture", async () => {
  for(const apply of [false,true]) {
    const s=routeFixture({enabled:true,rows:[{...row,started_at:new Date(Date.now()-90*60_000).toISOString()}]});
    const j=await (await s.route.POST(s.request(apply?"?apply=1":""))).json();
    assert.equal(j.ok,true);assert.equal(j.closed,apply?1:0);assert.equal(s.calls.filter(c=>c.patch).length,apply?1:0);
  }
});
test("route : échecs Supabase distincts et non rejoués", async () => {
  const s=routeFixture({readError:true});assert.equal((await s.route.POST(s.request())).status,503);assert.equal(s.calls.length,1);
  const w=routeFixture({enabled:true,writeError:true,rows:[{...row,started_at:new Date(Date.now()-90*60_000).toISOString()}]});
  assert.equal((await w.route.POST(w.request("?apply=1"))).status,503);assert.equal(w.calls.length,2);
});
