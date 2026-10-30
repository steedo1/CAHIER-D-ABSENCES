import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";

function load(path, globals = {}, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Blob, Promise, Date, JSON, AbortController, ...globals,
    require: name => { assert.ok(name in imports, name); return imports[name]; } });
  return module.exports;
}

test("disabled relay capability makes zero database requests for any institution", async () => {
  const { relayEnabledForInstitutionServer } = load("src/lib/relay-capability-server.ts", {}, {
    "./relay-capability": { RELAY_LOCAL_DISABLED: true },
  });
  const service = { from() { throw Error("Unexpected relay query"); } };
  for (let i = 0; i < 100; i++) assert.equal(await relayEnabledForInstitutionServer(service, `school-${i}`), false);
});

test("photo cache deduplicates downloads, isolates versions and institutions, expires and bounds memory", async () => {
  let clock = 1000, downloads = 0;
  const { createStudentPhotoCache } = load("src/lib/student-photo-cache.ts", { Date: { now: () => clock } });
  const read = createStudentPhotoCache({ maxBytes: 12, maxEntryBytes: 8, ttlMs: 100 });
  const download = async () => { downloads++; return new Blob(["123456"]); };
  const files = await Promise.all(Array.from({ length: 20 }, () => read("school-a/student/v1", download)));
  assert.equal(downloads, 1);
  for (const file of files) assert.equal(await file.text(), "123456");
  await read("school-b/student/v1", download); assert.equal(downloads, 2);
  await read("school-a/student/v2", download); assert.equal(downloads, 3);
  await read("school-a/student/v1", download); assert.equal(downloads, 4, "oldest entry evicted at byte limit");
  clock += 101;
  await read("school-a/student/v1", download); assert.equal(downloads, 5);
  const large = async () => { downloads++; return new Blob(["123456789"]); };
  await read("large", large); await read("large", large); assert.equal(downloads, 7);
  await read(null, download); await read(null, download); assert.equal(downloads, 9, "unversioned files always fresh");
});

test("photo failures are never cached and in-flight rejection is cleaned", async () => {
  const { createStudentPhotoCache } = load("src/lib/student-photo-cache.ts");
  const read = createStudentPhotoCache();
  await assert.rejects(read("photo", async () => { throw Error("offline"); }));
  assert.equal(await read("photo", async () => null), null);
  assert.equal(await (await read("photo", async () => new Blob(["ok"]))).text(), "ok");
});

const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
test("display polling pauses eight hidden hours, coalesces focus and backs off on errors", async () => {
  let clock = 0, timerId = 0, calls = 0, fail = false, release;
  const timers = new Map(), listeners = new Map();
  const document = { visibilityState: "visible", addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n) };
  const window = { addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n) };
  const navigator = { onLine: true };
  const { startVisiblePoll } = load("src/lib/visible-poll.ts", { document, window, navigator, Date: { now: () => clock },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: clock + delay }); return timerId; }, clearTimeout: id => timers.delete(id) });
  const stop = startVisiblePoll(async () => { calls++; if (release === "wait") await new Promise(resolve => { release = resolve; }); if (fail) throw Error("503"); }, 120000);
  await settle(); assert.equal(calls, 1);
  for (let i = 0; i < 100; i++) listeners.get("focus")();
  assert.equal(calls, 1);
  document.visibilityState = "hidden"; listeners.get("visibilitychange")();
  clock += 8 * 3600000; assert.equal(timers.size, 0); assert.equal(calls, 1);
  document.visibilityState = "visible"; release = "wait"; listeners.get("visibilitychange")();
  listeners.get("focus")(); listeners.get("online")(); assert.equal(calls, 2);
  release(); await settle();
  fail = true; clock += 120000; listeners.get("focus")(); await settle(); assert.equal(calls, 3);
  clock += 120000; listeners.get("focus")(); assert.equal(calls, 3, "error doubles retry delay");
  clock += 120000; fail = false; listeners.get("focus")(); await settle(); assert.equal(calls, 4);
  navigator.onLine = false; listeners.get("offline")(); assert.equal(timers.size, 0);
  stop(); assert.equal(listeners.size, 0); assert.equal(timers.size, 0);
});

test("photo route rechecks permissions before every cache read", async () => {
  let authorized = true, authenticated = true, downloads = 0, lookups = 0;
  const { readStudentPhoto } = load("src/lib/student-photo-cache.ts");
  const service = { from(table) {
    lookups++;
    const data = table === "students" ? { id: "student", institution_id: "school", photo_path: "school/student/photo.jpg", photo_updated_at: "v1" }
      : table === "profiles" ? { institution_id: authorized ? "school" : "other" }
      : table === "user_roles" ? [{ role: "file_correspondent", institution_id: authorized ? "school" : "other" }] : null;
    return { select() { return this; }, eq() { return this; }, or() { return this; }, limit() { return this; },
      maybeSingle: async () => ({ data, error: null }), then: (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject) };
  }, storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob(["photo"], { type: "image/jpeg" }), error: null }; } }) } };
  const client = { ...service, auth: { getUser: async () => ({ data: { user: authenticated ? { id: "user" } : null } }) } };
  const { GET } = load("src/app/api/media/student-photo/[studentId]/route.ts", { Response }, {
    "next/server": { NextResponse: Response },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => client },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/student-photo-cache": { readStudentPhoto },
  });
  const run = () => GET({}, { params: Promise.resolve({ studentId: "student" }) });
  for (let i = 0; i < 20; i++) {
    const response = await run(); assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control"), /private, no-store/);
    assert.equal(await response.text(), "photo");
  }
  assert.equal(downloads, 1); assert.equal(lookups, 60, "student and rights are never cached");
  authorized = false; assert.equal((await run()).status, 403); assert.equal(downloads, 1);
  authenticated = false; assert.equal((await run()).status, 401); assert.equal(downloads, 1);
});
