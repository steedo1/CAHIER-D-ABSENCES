import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const cookieHelpers = load("src/lib/auth/session-cookies.ts");
const { SESSION_STORAGE_KEY } = cookieHelpers;
const user = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", aud: "authenticated", role: "authenticated", email: "test@example.invalid" };
function token(exp) { return `header.${Buffer.from(JSON.stringify({ exp, sub: user.id })).toString("base64url")}.signature`; }
function session(exp) { return { access_token: token(exp), refresh_token: "test-refresh", expires_at: exp, expires_in: 3600, token_type: "bearer", user }; }
function jar(values) {
  const all = new Map(values.map((c) => [c.name, c.value]));
  return { getAll: () => [...all].map(([name,value]) => ({name,value})), get: (name) => all.has(name) ? {name,value:all.get(name)} : undefined, set: (name,value) => all.set(name,value) };
}

test("20 contrôles du même client partagent une vérification sans setSession", async () => {
  let calls = 0;
  const cookies = jar([{name: SESSION_STORAGE_KEY, value: JSON.stringify(session(Math.floor(Date.now()/1000)+3600))}]);
  const client = { auth: { getUser: async () => { calls++; await new Promise(r=>setTimeout(r,5)); return {data:{user},error:null}; }, onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}) } };
  const saved = process.env.SUPABASE_URL, savedKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://project.supabase.co"; process.env.SUPABASE_ANON_KEY = "test";
  try {
    const server = load("src/lib/supabase-server.ts", { react: {cache: f=>f}, "next/headers": {cookies:async()=>cookies}, "@supabase/ssr": {createServerClient:()=>client}, "./auth/session-cookies":cookieHelpers });
    const supa = await server.getSupabaseServerClient();
    const results = await Promise.all(Array.from({length:20},()=>server.getVerifiedServerUser(supa)));
    assert.equal(calls,1); assert.ok(results.every(r=>r.data.user.id===user.id));
  } finally { if(saved===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=saved; if(savedKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=savedKey; }
});

test("le SDK réel renouvelle une session expirée, persiste les cookies et ne renouvelle plus à la navigation suivante", async () => {
  const savedFetch=globalThis.fetch, savedUrl=process.env.SUPABASE_URL, savedKey=process.env.SUPABASE_ANON_KEY;
  const counts={token:0,user:0}; const nextSession=session(Math.floor(Date.now()/1000)+3600);
  globalThis.fetch=async(input)=>{const url=String(input); if(url.includes('/token')) {counts.token++;return Response.json(nextSession)} if(url.includes('/user')) {counts.user++;return Response.json(user)} throw Error(url)};
  process.env.SUPABASE_URL="https://project.supabase.co";process.env.SUPABASE_ANON_KEY="test";
  try {
    const {NextRequest}=require('next/server');
    const middleware=load('src/lib/auth/session-middleware.ts',{"./session-cookies":cookieHelpers});
    const expired=session(Math.floor(Date.now()/1000)-60);
    const first=new NextRequest('https://example.invalid/admin',{headers:{cookie:`${SESSION_STORAGE_KEY}=${encodeURIComponent(JSON.stringify(expired))}`}});
    const response=await middleware.updateServerSession(first);
    assert.equal(counts.token,1); assert.ok(response.cookies.getAll().some(c=>cookieHelpers.isSessionCookie(c.name)));
    const requestJar=jar(first.cookies.getAll());
    const server=load('src/lib/supabase-server.ts',{react:{cache:f=>f},'next/headers':{cookies:async()=>requestJar},'./auth/session-cookies':cookieHelpers});
    const client=await server.getSupabaseServerClient();
    await Promise.all([server.getVerifiedServerUser(client),server.getVerifiedServerUser(client)]);
    assert.equal(counts.user,1); assert.equal(counts.token,1);
    const header=first.cookies.getAll().map(c=>`${c.name}=${encodeURIComponent(c.value)}`).join('; ');
    const second=new NextRequest('https://example.invalid/api/admin/classes',{headers:{cookie:header}});
    await middleware.updateServerSession(second);
    assert.equal(counts.token,1); assert.equal(counts.user,1);
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  } finally {globalThis.fetch=savedFetch;if(savedUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=savedUrl;if(savedKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=savedKey;}
});

test("les cookies SDK découpés ont priorité sur les anciens tokens", () => {
  const canonical=[{name:`${SESSION_STORAGE_KEY}.0`,value:'base64-new'},{name:'sb-access-token',value:token(1)},{name:'sb-refresh-token',value:'old'}];
  assert.deepEqual(cookieHelpers.sessionCookies(canonical,'https://project.supabase.co'),canonical);
  const legacy=cookieHelpers.sessionCookies([{name:'sb-access-token',value:token(1234)},{name:'sb-refresh-token',value:'old'}],'https://project.supabase.co');
  assert.equal(JSON.parse(legacy.at(-1).value).expires_at,1234);
});

test("les profils et rôles sont dédupliqués et les établissements restent isolés", async () => {
  const context=load('src/lib/auth/server-context.ts',{'../supabase-server':{getVerifiedServerUser:c=>c.auth.getUser()}});
  let profiles=0,roles=0;
  function clients(institution,roleInstitution) {
    const client={auth:{getUser:async()=>({data:{user},error:null})},from:()=>({select(selection){assert.equal(selection,'id,institution_id');return this},eq(){return this},async maybeSingle(){profiles++;return {data:{id:user.id,institution_id:institution},error:null}}})};
    const reader={from:()=>({select(){return this},async eq(){roles++;return {data:[{role:'admin',institution_id:roleInstitution}],error:null}}})};return [client,reader];
  }
  const [a,reader]=clients('school-a','school-a');
  const result=await Promise.all(Array.from({length:20},()=>context.requireInstitutionRole(a,reader,['admin'])));
  assert.equal(profiles,1);assert.equal(roles,1);assert.ok(result.every(r=>r.instId==='school-a'));
  const [b,bReader]=clients('school-b','school-a');
  assert.deepEqual(await context.requireInstitutionRole(b,bReader,['admin']),{error:'forbidden'});
  assert.equal(profiles,2);assert.equal(roles,2);
});
