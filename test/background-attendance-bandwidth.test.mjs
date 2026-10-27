import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const settle = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

async function preparationFixture(role, visibility = "visible") {
  const effects = [], calls = [], storage = new Map(), prepared = [];
  const documentListeners = new Map(), windowListeners = new Map();
  let clock = 1_000_000, interval;
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
  const document = { visibilityState: visibility, addEventListener: (name, callback) => documentListeners.set(name, callback), removeEventListener() {} };
  const context = vm.createContext({
    module, exports: module.exports,
    require: name => { assert.ok(name in mocks, `unexpected dependency ${name}`); return mocks[name]; },
    window: { setTimeout, clearTimeout, setInterval: callback => { interval = callback; return 1; }, clearInterval() {}, addEventListener: (name, callback) => windowListeners.set(name, callback), removeEventListener() {}, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
    navigator: {}, document,
    Date: class extends Date { static now() { return clock; } },
    AbortController, queueMicrotask,
    fetch: async path => { calls.push(path); return Response.json({ user_id: "fixture-user", role, institution_id: "fixture-school" }); },
  });
  const source = ts.transpileModule(await read("src/components/BackgroundAttendancePreparation.tsx"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(source, context);
  module.exports.default();
  effects.forEach(fn => fn());
  await settle();
  return {
    calls, storage, prepared,
    async tick() { clock += 60_000; interval(); await settle(); },
    async visible(value) { document.visibilityState = value ? "visible" : "hidden"; documentListeners.get("visibilitychange")(); await settle(); },
    async event(name) { windowListeners.get(name)(); await settle(); },
  };
}

for (const role of ["admin", "teacher", "class_device"]) {
  test(`${role}: background preparation respects cloud-only administration and preserves phone PWA`, async () => {
    const { calls, prepared, storage } = await preparationFixture(role);
    assert.deepEqual(calls, ["/api/auth/role"]);
    assert.deepEqual(prepared, role === "admin" ? [] : [role === "teacher" ? "teacher" : "class-device"]);
    assert.equal([...storage.keys()].some(key => key.includes("preparation:success")), role !== "admin");
  });

  test(`${role}: eight hidden hours make zero requests and returning to the screen checks immediately`, async () => {
    const f = await preparationFixture(role, "hidden");
    for (let minute = 0; minute < 480; minute++) await f.tick();
    await f.event("focus");
    await f.event("online");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.prepared, []);
    assert.equal(f.storage.size, 0, "hidden timers must not consume the foreground check throttle");
    await f.visible(true);
    assert.deepEqual(f.calls, ["/api/auth/role"]);
    assert.deepEqual(f.prepared, role === "admin" ? [] : [role === "teacher" ? "teacher" : "class-device"]);
    await f.event("focus");
    assert.equal(f.calls.length, 1, "foreground events still share the existing throttle");
    await f.visible(false);
    await f.tick();
    assert.equal(f.calls.length, 1);
    await f.visible(true);
    assert.equal(f.calls.length, 2, "a visible user can still receive fresh timetable revisions");
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
    Request: class extends Request { constructor(input, init) { super(typeof input === "string" ? new URL(input, "https://fixture.invalid") : input, init); } },
    Response, Headers, URL, AbortController, setTimeout, clearTimeout,
    fetch: async req => {
      const url = new URL(req.url); calls.push(url.pathname);
      if (url.pathname.startsWith("/_next/") && failChunk) return new Response("unavailable", { status: 503 });
      return new Response(url.pathname.endsWith(".js") || url.pathname.endsWith(".svg") ? "asset" : html,
        { headers: { "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : url.pathname.endsWith(".svg") ? "image/svg+xml" : "text/html" } });
    },
  });
  vm.runInContext(await read("public/moncahier-sw.js"), context);
  return { calls, stores, warm: path => context.warmDocument(path), precache: () => context.precacheApplicationFiles(), setHtml: value => { html = value; }, fail: () => { failChunk = true; }, immutablePaths: () => Array.from(vm.runInContext("IMMUTABLE_BRANDING_PATHS", context)) };
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


test("PWA warming reuses only explicitly public immutable branding and exact asset URLs", async () => {
  const f = await workerFixture();
  f.setHtml('<img src="/icons/icon-192.v2.png"><img src="/home/hero-notes.v2.webp"><img src="/students/photo.v2.png"><img src="/logo.svg">');
  await f.warm("/login");
  await f.warm("/class");
  assert.equal(f.calls.filter(path => path === "/icons/icon-192.v2.png").length, 1);
  assert.equal(f.calls.filter(path => path === "/home/hero-notes.v2.webp").length, 1);
  assert.equal(f.calls.filter(path => path === "/students/photo.v2.png").length, 2, "a version-like private name is not public branding");
  assert.equal(f.calls.filter(path => path === "/logo.svg").length, 2);
  f.setHtml('<img src="/icons/icon-192.v2.png?revision=other">');
  await f.warm("/login");
  assert.equal(f.calls.filter(path => path === "/icons/icon-192.v2.png").length, 2, "a different URL cannot reuse another asset's bytes");
});

test("PWA branding allowlist stays aligned with public immutable HTTP headers", async () => {
  const f = await workerFixture();
  const { default: config } = await import("../next.config.mjs");
  const paths = (await config.headers()).filter(entry => entry.headers.some(header => header.key === "Cache-Control" && header.value.includes("immutable"))).map(entry => entry.source);
  assert.deepEqual(f.immutablePaths().sort(), paths.sort());
});


test("updating the worker preserves verified immutable icons but refreshes unversioned precache files", async () => {
  const f = await workerFixture();
  f.setHtml('<img src="/icons/icon-192.v2.png">');
  await f.warm("/login");
  await f.precache();
  await f.precache();
  assert.equal(f.calls.filter(path => path === "/icons/icon-192.v2.png").length, 1);
  assert.equal(f.calls.filter(path => path === "/icons/icon-512.v2.png").length, 1);
  assert.equal(f.calls.filter(path => path === "/manifest.webmanifest").length, 2);
  assert.equal(f.calls.filter(path => path === "/moncahier-offline.html").length, 2);
  const assets = f.stores.get("moncahier-assets-v2");
  assets.set("https://fixture.invalid/icons/icon-192.v2.png", new Response("bad", { status: 503 }));
  await f.precache();
  assert.equal(f.calls.filter(path => path === "/icons/icon-192.v2.png").length, 2, "an invalid cached response must be fetched again");
});
