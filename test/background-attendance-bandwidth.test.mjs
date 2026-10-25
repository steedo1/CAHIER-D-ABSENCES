import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

for (const role of ["admin", "teacher", "class_device"]) {
  test(`${role}: background preparation respects cloud-only administration and preserves phone PWA`, async () => {
    const effects = [], calls = [], storage = new Map(), prepared = [];
    const module = { exports: {} };
    const mocks = {
      react: { useEffect: fn => effects.push(fn), useLayoutEffect: fn => effects.push(fn), useRef: current => ({ current }) },
      "@/app/providers": { useAuth: () => ({ loading: false, session: { user: { id: "fixture-user" } } }) },
      "@/lib/offline-readiness": {
        getOfflineReadiness: async () => ({ schedule_revision: 1 }),
        prepareOffline: async target => prepared.push(target),
      },
      "@/lib/cloud-availability": { probeCloudSchedule: async () => ({ schedule_revision: 1 }) },
      "@/lib/admin-essential-fetch": { setAdminEssentialSessionUser() {} },
      "@/lib/offline-auth-client": { getOfflineAccessIntent: async () => null, getOrCreateOfflineDeviceId: () => "fixture-device" },
      "@/lib/offline-auth-contract": { isOfflineAccessRole: value => ["admin", "teacher", "class_device"].includes(value) },
      "@/lib/background-attendance-preparation-policy": { ATTENDANCE_PREPARATION_CHECK_INTERVAL_MS: 60000, shouldRunAttendancePreparation: () => true },
      "@/lib/relay-capability": { rememberRelayCapability() {} },
    };
    const context = vm.createContext({
      module, exports: module.exports,
      require: name => { assert.ok(name in mocks, `unexpected dependency ${name}`); return mocks[name]; },
      window: { setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {}, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
      navigator: {}, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
      AbortController, queueMicrotask,
      fetch: async path => { calls.push(path); return Response.json({ user_id: "fixture-user", role, institution_id: "fixture-school" }); },
    });
    const source = ts.transpileModule(await read("src/components/BackgroundAttendancePreparation.tsx"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(source, context);
    module.exports.default();
    effects.forEach(fn => fn());
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ["/api/auth/role"]);
    assert.deepEqual(prepared, role === "admin" ? [] : [role === "teacher" ? "teacher" : "class-device"]);
    assert.equal([...storage.keys()].some(key => key.includes("preparation:success")), role !== "admin");
  });
}

async function workerFixture() {
  const stores = new Map(), calls = [];
  let html = '<script src="/_next/static/chunks/shared-a1b2.js"></script><img src="/logo.svg">';
  let failChunk = false;
  const cacheFor = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    const key = req => typeof req === "string" ? req : req.url;
    return { match: async req => store.get(key(req))?.clone(), put: async (req, res) => store.set(key(req), res.clone()) };
  };
  const context = vm.createContext({
    self: { location: { origin: "https://fixture.invalid" }, addEventListener() {}, clients: {}, registration: {} },
    caches: { open: async name => cacheFor(name) },
    Request, Response, Headers, URL, AbortController, setTimeout, clearTimeout,
    fetch: async req => {
      const url = new URL(req.url); calls.push(url.pathname);
      if (url.pathname.startsWith("/_next/") && failChunk) return new Response("unavailable", { status: 503 });
      return new Response(url.pathname.endsWith(".js") || url.pathname.endsWith(".svg") ? "asset" : html,
        { headers: { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : url.pathname.endsWith(".svg") ? "image/svg+xml" : "text/html" } });
    },
  });
  vm.runInContext(await read("public/moncahier-sw.js"), context);
  return { calls, stores, warm: path => context.warmDocument(path), setHtml: value => { html = value; }, fail: () => { failChunk = true; } };
}

test("PWA warming reuses exact immutable chunks across repeated pages and fetches a new release", async () => {
  const fixture = await workerFixture();
  await fixture.warm("/login");
  await fixture.warm("/class");
  await fixture.warm("/login");
  assert.equal(fixture.calls.filter(path => path === "/_next/static/chunks/shared-a1b2.js").length, 1);
  assert.equal(fixture.calls.filter(path => path === "/logo.svg").length, 3, "unversioned assets still refresh");
  assert.equal(fixture.calls.filter(path => path === "/login").length, 2, "documents still refresh");
  fixture.setHtml('<script src="/_next/static/chunks/shared-new-release.js"></script>');
  await fixture.warm("/login");
  assert.equal(fixture.calls.filter(path => path === "/_next/static/chunks/shared-new-release.js").length, 1);
});

test("PWA keeps the previous working document when a new essential chunk fails", async () => {
  const fixture = await workerFixture();
  await fixture.warm("/login");
  const shell = fixture.stores.get("moncahier-shell-v2");
  const before = await shell.get("https://fixture.invalid/login").clone().text();
  fixture.setHtml('<script src="/_next/static/chunks/missing-release.js"></script>');
  fixture.fail();
  await assert.rejects(fixture.warm("/login"), /503/);
  assert.equal(await shell.get("https://fixture.invalid/login").clone().text(), before);
});
