import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function evaluate(path, imports, source = read(path)) {
  const exports = {};
  new Function("exports", "require", compile(source))(exports, (name) => {
    if (name === "react/jsx-runtime") {
      const jsx = (type, props) => ({ type, props, children: Array.isArray(props.children) ? props.children : [props.children] });
      return { jsx, jsxs: jsx };
    }
    assert.ok(name in imports, `unexpected import ${name}`);
    return imports[name];
  });
  return exports;
}
const ast = ts.createSourceFile("fake.ts", read("test/offline-outbox-ordering.test.ts"), ts.ScriptTarget.Latest, true);
const fake = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "installFakeIndexedDb");
const installFake = new Function(`${compile(fake.getText(ast))}; return installFakeIndexedDb;`)();
const contract = evaluate("src/lib/offline-auth-contract.ts", {});
const ACTIVE = "mc:offline-auth:active:v1";
const DEVICE = "mc:offline-auth:device-id:v1";
const deviceId = "device_11111111-2222-4333-8444-555555555555";
const password = "mot-de-passe-test";
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function storage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key), clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; } };
}
function browser() {
  const target = new EventTarget();
  const cookies = new Map();
  globalThis.window = {
    localStorage: storage(), sessionStorage: storage(), setTimeout, clearTimeout,
    dispatchEvent: (event) => target.dispatchEvent(event),
    addEventListener: (...args) => target.addEventListener(...args),
    removeEventListener: (...args) => target.removeEventListener(...args),
    location: { protocol: "https:", origin: "https://www.mon-cahier.com", search: "", pathname: "/class" },
  };
  globalThis.document = {
    get cookie() { return [...cookies].filter(([key]) => window.location.pathname.startsWith(key.split("|")[0]))
      .map(([, value]) => value).join("; "); },
    set cookie(raw) {
      const path = raw.match(/Path=([^;]+)/)?.[1] || "/";
      const pair = raw.split(";")[0];
      const key = `${path}|${pair.split("=")[0]}`;
      if (raw.includes("Max-Age=0;")) cookies.delete(key); else cookies.set(key, pair);
    },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  window.localStorage.setItem(DEVICE, deviceId);
  return window;
}
async function credentials(role = "class_device", identifier = "07 01 02 03 04", legacy = false) {
  installFake(); browser();
  let prepared = true;
  let useLegacy = legacy;
  const load = () => evaluate("src/lib/offline-auth-client.ts", {
    "@/lib/offline-auth-contract": contract,
    "@/lib/offline-auth-readiness": { assertOfflineFunctionPrepared: async () => {
      if (!prepared) throw new Error("offline_function_not_prepared");
    } },
  }, useLegacy ? execFileSync("git", ["show", "3425eb52:src/lib/offline-auth-client.ts"],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" }) : read("src/lib/offline-auth-client.ts"));
  let api = load();
  const grant = await contract.issueOfflineAccessGrant({
    secret: "test-secret".padEnd(64, "s"), userId: "user-11111111", institutionId: "CSCA",
    classId: role === "class_device" ? "class-11111111" : null, deviceId, role, ttlMs: 60_000,
  });
  const input = { mode: "phone", identifier, password, grantToken: grant.token };
  await api.provisionOfflineAccess(input);
  window.location.pathname = grant.payload.destination;
  return { input, grant, get api() { return api; }, setPrepared: (value) => { prepared = value; },
    reopen() { window.sessionStorage.clear(); api = load(); },
    upgrade() { useLegacy = false; api = load(); } };
}

test("régression réelle : TA1 et TB1 étaient confondus par l'ancien identifiant hors ligne", async () => {
  const fixture = await credentials("class_device", "TA1", true);
  const wrongAccount = await fixture.api.authenticateOfflineAccess({ ...fixture.input, identifier: "TB1" });
  assert.equal(wrongAccount.payload.class_id, fixture.grant.payload.class_id);
  fixture.upgrade();
  await assert.rejects(fixture.api.authenticateOfflineAccess({ ...fixture.input, identifier: "TB1" }), /offline_access_not_prepared/);
});
test("deux classes aux identifiants TA1/TB1 et au même mot de passe retrouvent chacune leur propre compte", async () => {
  const fixture = await credentials("class_device", "TA1");
  const second = await contract.issueOfflineAccessGrant({ secret: "test-secret".padEnd(64, "s"),
    userId: "user-22222222", institutionId: "CSCA", classId: "class-22222222", deviceId, role: "class_device", ttlMs: 60_000 });
  await fixture.api.provisionOfflineAccess({ ...fixture.input, identifier: "TB1", grantToken: second.token });
  fixture.reopen();
  const firstLogin = await fixture.api.authenticateOfflineAccess({ ...fixture.input, identifier: " ta1 " });
  const secondLogin = await fixture.api.authenticateOfflineAccess({ ...fixture.input, identifier: "tb1" });
  assert.equal(firstLogin.payload.user_id, fixture.grant.payload.user_id);
  assert.equal(firstLogin.payload.class_id, fixture.grant.payload.class_id);
  assert.equal(secondLogin.payload.user_id, second.payload.user_id);
  assert.equal(secondLogin.payload.class_id, second.payload.class_id);
  await assert.rejects(fixture.api.authenticateOfflineAccess({ ...fixture.input, identifier: "TC1" }), /offline_access_not_prepared/);
});
test("la remise à niveau d'un ancien compte classe conserve ses appels et exige une connexion vérifiée", async () => {
  const fixture = await credentials("class_device", "0701020304", true);
  window.localStorage.setItem("appel-en-attente", "conservé"); fixture.upgrade();
  await assert.rejects(fixture.api.authenticateOfflineAccess(fixture.input), /offline_class_identifier_requires_update/);
  await fixture.api.provisionOfflineAccess(fixture.input);
  assert.equal((await fixture.api.authenticateOfflineAccess(fixture.input)).payload.class_id, fixture.grant.payload.class_id);
  assert.equal(window.localStorage.getItem("appel-en-attente"), "conservé");
});
test("un ancien compte professeur à numéro de téléphone conserve sa reconnexion locale", async () => {
  const fixture = await credentials("teacher", "0701020304", true);
  fixture.upgrade();
  assert.equal((await fixture.api.authenticateOfflineAccess(fixture.input)).payload.user_id, fixture.grant.payload.user_id);
});

for (const role of ["class_device", "teacher"]) {
  test(`${role} : fermeture complète de la PWA puis retour sans réseau conserve le même accès`, async () => {
    const fixture = await credentials(role);
    window.localStorage.setItem("appel-en-attente", "conservé");
    assert.equal((await fixture.api.getActiveOfflineAccess()).payload.user_id, fixture.grant.payload.user_id);
    fixture.reopen();
    const restored = await fixture.api.getActiveOfflineAccess();
    assert.equal(restored.payload.destination, fixture.grant.payload.destination);
    assert.equal(restored.payload.class_id, fixture.grant.payload.class_id);
    assert.equal(window.localStorage.getItem("appel-en-attente"), "conservé");
  });
}
test("une session ouverte v1 migre sans activer un autre compte préparé", async () => {
  const fixture = await credentials();
  window.localStorage.removeItem(ACTIVE);
  assert.ok(await fixture.api.getActiveOfflineAccess());
  fixture.reopen();
  assert.ok(await fixture.api.getActiveOfflineAccess());
  await fixture.api.clearActiveOfflineAccess();
  assert.equal(await fixture.api.getOfflineAccessIntent(), null);
});
test("l'autorisation en ligne Admin conserve son fonctionnement sans activation automatique", async () => {
  const fixture = await credentials("admin");
  assert.equal(await fixture.api.getOfflineAccessIntent(), null);
  const authorized = await fixture.api.authenticateOfflineAccess(fixture.input);
  fixture.api.activateOfflineAccess(authorized);
  assert.equal((await fixture.api.getActiveOfflineAccess()).payload.role, "admin");
});
test("le verrou de déconnexion ne dépend pas d'IndexedDB et un stockage refusé ne casse pas le login Cloud", async () => {
  const fixture = await credentials();
  const idb = globalThis.indexedDB;
  try {
    globalThis.indexedDB = undefined;
    fixture.api.setOfflineLogoutLock("/class");
    await fixture.api.clearActiveOfflineAccess();
    assert.equal(fixture.api.getOfflineLogoutLock(), "/class");
    fixture.api.clearOfflineLogoutLock();
    window.localStorage.getItem = () => { throw new Error("storage_denied"); };
    window.localStorage.removeItem = () => { throw new Error("storage_denied"); };
    assert.equal(fixture.api.getOfflineLogoutLock(), null);
    assert.doesNotThrow(() => fixture.api.clearOfflineLogoutLock());
  } finally { globalThis.indexedDB = idb; }
});
test("déconnexion puis fermeture : accès verrouillé, mauvais mot de passe refusé, reconnexion locale possible", async () => {
  const fixture = await credentials();
  window.localStorage.setItem("préparation-classe", "conservée");
  fixture.api.setOfflineLogoutLock("/class");
  await fixture.api.clearActiveOfflineAccess();
  fixture.reopen();
  assert.equal(fixture.api.getOfflineLogoutLock(), "/class");
  assert.equal(await fixture.api.getActiveOfflineAccess(), null);
  await assert.rejects(fixture.api.authenticateOfflineAccess({ ...fixture.input, password: "incorrect" }), /offline_credentials_invalid/);
  assert.equal(fixture.api.getOfflineLogoutLock(), "/class");
  const authorized = await fixture.api.authenticateOfflineAccess(fixture.input);
  fixture.api.activateOfflineAccess(authorized);
  assert.equal(fixture.api.getOfflineLogoutLock(), null);
  assert.ok(await fixture.api.getActiveOfflineAccess());
  assert.equal(window.localStorage.getItem("préparation-classe"), "conservée");
});
test("l'expiration, le mauvais appareil et la désactivation ne deviennent pas un accès persistant", async () => {
  const fixture = await credentials();
  const originalNow = Date.now;
  try {
    Date.now = () => fixture.grant.payload.expires_at;
    assert.equal(await fixture.api.getOfflineAccessIntent(), null);
    await assert.rejects(fixture.api.authenticateOfflineAccess(fixture.input), /offline_access_expired/);
  } finally { Date.now = originalNow; }
  window.localStorage.setItem(DEVICE, "device_99999999-2222-4333-8444-555555555555");
  assert.equal(await fixture.api.getOfflineAccessIntent(), null);
  window.localStorage.setItem(DEVICE, deviceId);
  await fixture.api.disableOfflineAccessForIdentifier(fixture.input);
  assert.equal(await fixture.api.getOfflineAccessIntent(), null);
  await assert.rejects(fixture.api.authenticateOfflineAccess(fixture.input), /offline_access_disabled/);
});
test("le mot de passe ne suffit pas sans préparation complète et un token remplacé n'est pas accepté", async () => {
  const fixture = await credentials(); fixture.setPrepared(false);
  await assert.rejects(fixture.api.authenticateOfflineAccess(fixture.input), /offline_function_not_prepared/);
  const active = JSON.parse(window.localStorage.getItem(ACTIVE));
  window.localStorage.setItem(ACTIVE, JSON.stringify({ ...active, grant_token: `${active.grant_token}x` }));
  assert.equal(await fixture.api.getOfflineAccessIntent(), null);
});

function hooks() {
  const states = [], effects = [];
  let index = 0;
  const react = { createContext: () => ({ Provider() {} }), createElement: (type, props, ...children) => ({ type, props, children }),
    useMemo: (fn) => fn(), useRef: (value) => ({ current: value }),
    useContext: () => ({}), useState: (initial) => {
      const key = index++;
      if (!(key in states)) states[key] = initial;
      return [states[key], (value) => { states[key] = typeof value === "function" ? value(states[key]) : value; }];
    }, useEffect: (effect) => effects.push(effect) };
  return { react, states, effects, render(fn) { index = 0; effects.length = 0; return fn(); } };
}
function providerFixture({ intent = null, lock = null, cloud = new Promise(() => {}), online = false } = {}) {
  browser(); navigator.onLine = online;
  const timers = new Map(); let next = 0, callback;
  window.setTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  const fixture = { intent, lock, actor: undefined, fetches: 0 };
  globalThis.fetch = async () => { fixture.fetches++; return new Promise(() => {}); };
  const ui = hooks();
  const providers = evaluate("src/app/providers.tsx", {
    react: ui.react,
    "@/lib/supabase-browser": { getSupabaseBrowserClient: () => ({ auth: {
      getSession: () => cloud, onAuthStateChange: (cb) => { callback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    } }) },
    "@/lib/attendance-cache-identity": { setAttendanceCacheActor: (actor) => { fixture.actor = actor; } },
    "@/lib/attendance-network": { resetAttendanceCloudProbe() {} },
    "@/lib/offline-auth-client": { OFFLINE_AUTH_STATE_EVENT: "offline-auth", getOfflineAccessIntent: async () => fixture.intent,
      getOfflineLogoutLock: () => fixture.lock },
  });
  ui.render(() => providers.default({ children: null }));
  fixture.cleanup = ui.effects[0]();
  fixture.states = ui.states;
  fixture.change = (...args) => callback(...args);
  fixture.localChange = () => window.dispatchEvent(new Event("offline-auth"));
  fixture.tick = async (ms) => {
    for (const [key, timer] of [...timers]) if (timer.ms === ms) { timers.delete(key); timer.fn(); }
    await flush();
  };
  return fixture;
}
const localA = { payload: { user_id: "A" } }, localB = { payload: { user_id: "B" } };
const cloudA = { user: { id: "A" }, access_token: "test-access", refresh_token: "test-refresh" };
test("LoginCard hors ligne ne contacte aucune API et valide le rôle avant toute activation", async () => {
  for (const destination of ["/class", "/attendance"]) {
    browser(); let fetches = 0, activated = 0, authenticated = 0;
    window.localStorage.setItem("mca-auth-v1", "ancienne-session");
    globalThis.fetch = async () => { fetches++; throw new Error("must_not_fetch"); };
    const ui = hooks();
    const login = evaluate("src/components/auth/LoginCard.tsx", {
      react: ui.react, "@/lib/supabase-browser": { getSupabaseBrowserClient() { throw new Error("must_not_get_cloud"); } },
      "@/lib/offline-auth-client": {
        activateOfflineAccess() { activated++; }, authenticateOfflineAccess: async ({ password: received }) => {
          assert.equal(received, password); return { payload: { destination } };
        }, clearActiveOfflineAccess() {}, clearOfflineLogoutLock() {}, disableOfflineAccessForIdentifier() {},
        getOrCreateOfflineDeviceId() {}, provisionOfflineAccess() {},
      },
    });
    const props = { requiredDestination: "/class", onAuthenticated() { authenticated++; } };
    ui.render(() => login.default(props)); ui.states[2] = "0701020304"; ui.states[3] = password;
    const tree = ui.render(() => login.default(props));
    await tree.children.find((child) => child?.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(fetches, 0);
    assert.equal(activated, destination === "/class" ? 1 : 0);
    assert.equal(authenticated, activated);
    if (!activated) assert.equal(window.localStorage.getItem("mca-auth-v1"), "ancienne-session");
  }
});
test("le retour professeur garde la nouvelle séance locale et ne rouvre pas une séance clôturée", async () => {
  const api = evaluate("src/lib/teacher-session-resume.ts", {});
  const local = { id: "local-new", actual_call_at: "2026-10-13T08:00:00Z" };
  const cached = { id: "cloud-old", actual_call_at: "2026-10-13T07:00:00Z" };
  const finalized = new Set([cached.id]);
  const isFinalized = async (id) => finalized.has(id);
  assert.equal(await api.selectTeacherSessionToResume({ localOpen: local, serverOpen: cached, isFinalized }), local);
  assert.equal(await api.selectTeacherSessionToResume({ localOpen: null, serverOpen: cached, isFinalized }), null);
  finalized.add(local.id);
  assert.equal(await api.selectTeacherSessionToResume({ localOpen: local, serverOpen: cached, isFinalized }), null);
  assert.equal(await api.selectTeacherSessionToResume({ localOpen: { id: "closed", session_state: "closed" }, serverOpen: null,
    isFinalized: async () => false }), null);
});
test("un refresh Supabase qui ne répond jamais ne retarde pas le compte local", async () => {
  const fixture = providerFixture({ intent: localA }); await flush();
  assert.equal(fixture.states[1], false); assert.equal(fixture.actor, "A");
  assert.equal(fixture.fetches, 0); fixture.cleanup();
});
test("la session Cloud s'affiche avant la copie des cookies et le timeout local ne l'efface pas", async () => {
  const fixture = providerFixture({ cloud: Promise.resolve({ data: { session: cloudA } }), online: true }); await flush();
  assert.equal(fixture.states[0], cloudA); assert.equal(fixture.states[1], false);
  assert.equal(fixture.fetches, 1); await fixture.tick(2000);
  assert.equal(fixture.states[0], cloudA); fixture.cleanup();
});
test("sans aucun accès local, l'attente réseau rend un écran bloqué au bout du budget", async () => {
  const fixture = providerFixture(); await flush(); assert.equal(fixture.states[1], true);
  await fixture.tick(2000); assert.equal(fixture.states[1], false); assert.equal(fixture.actor, null); fixture.cleanup();
});
test("un vieux refresh A ne remplace pas une reconnexion hors ligne B", async () => {
  let resolveCloud;
  const fixture = providerFixture({ intent: localA, cloud: new Promise((resolve) => { resolveCloud = resolve; }), online: true });
  await flush(); fixture.intent = localB; fixture.localChange(); await flush();
  resolveCloud({ data: { session: cloudA } }); await flush();
  assert.equal(fixture.actor, "B"); assert.equal(fixture.states[0], null);
  assert.equal(fixture.change("TOKEN_REFRESHED", cloudA), undefined);
  await fixture.tick(0); assert.equal(fixture.actor, "B"); assert.equal(fixture.fetches, 0); fixture.cleanup();
});
test("aucun événement Cloud ne déverrouille une déconnexion explicite", async () => {
  const fixture = providerFixture({ intent: localA, online: true }); await flush();
  fixture.intent = null; fixture.lock = "/class"; fixture.localChange(); await flush();
  fixture.change("SIGNED_IN", cloudA); await fixture.tick(0);
  assert.equal(fixture.actor, null); assert.equal(fixture.states[0], null); assert.equal(fixture.fetches, 0); fixture.cleanup();
});

function guardFixture({ pathname = "/class", destination = "/class", role = "class_device", lock = null, prepared = true,
  active = true, session = null, search = "" } = {}) {
  browser(); window.location.search = search;
  const navigations = []; window.location.replace = (path) => navigations.push(path);
  const ui = hooks(); const intent = active ? { payload: { destination, role, user_id: "A" } } : null;
  function LoginCard() {}
  const guard = evaluate("src/components/OfflineAccessGuard.tsx", {
    react: ui.react, "next/navigation": { usePathname: () => pathname },
    "@/app/providers": { useAuth: () => ({ session, loading: false }) },
    "@/components/auth/LoginCard": { default: LoginCard, __esModule: true },
    "@/components/RelayCapabilityProvider": { useRelayCapability: () => ({ relayEnabled: false, resolved: true }) },
    "@/lib/offline-auth-contract": contract,
    "@/lib/offline-auth-client": { OFFLINE_AUTH_STATE_EVENT: "offline-auth", getOfflineLogoutLock: () => lock,
      getOfflineAccessIntent: async () => lock ? null : intent, getActiveOfflineAccess: async () => lock ? null : intent,
      clearOfflineLogoutLock() {} },
    "@/lib/offline-auth-readiness": { assertOfflineFunctionPrepared: async () => {
      if (!prepared) throw new Error("not_prepared");
    } },
  });
  ui.render(() => guard.default({ children: "CALL" }));
  const cleanups = ui.effects.map((effect) => effect());
  return { ui, navigations, render: () => ui.render(() => guard.default({ children: "CALL" })),
    cleanup: () => cleanups.forEach((fn) => fn?.()) };
}
test("le shell sauvegardé ne donne pas accès à un autre rôle ou à des données non préparées", async () => {
  for (const options of [{ pathname: "/attendance" }, { prepared: false }]) {
    const fixture = guardFixture(options); await flush();
    assert.equal(fixture.ui.states[0].status, "blocked"); fixture.cleanup();
  }
  const fixture = guardFixture(); await flush(); assert.equal(fixture.render(), "CALL"); fixture.cleanup();
});
test("une session Cloud normale reste utilisable sans exiger une préparation locale", async () => {
  const fixture = guardFixture({ active: false, prepared: false, session: cloudA }); await flush();
  assert.equal(fixture.render(), "CALL"); fixture.cleanup();
});
test("le lancement hors ligne reprend l'espace préparé, mais jamais après Déconnexion", async () => {
  for (const pathname of ["/", "/login"]) {
    const fixture = guardFixture({ pathname, search: "?offline_resume=1" }); await flush();
    assert.deepEqual(fixture.navigations, ["/class"]); fixture.cleanup();
  }
  const fixture = guardFixture({ pathname: "/login", lock: "/class", search: "?offline_resume=1" }); await flush();
  assert.deepEqual(fixture.navigations, []); fixture.cleanup();
});
test("classe et professeur gardent un formulaire local dans le runtime après déconnexion", async () => {
  for (const pathname of ["/class", "/attendance"]) {
    const fixture = guardFixture({ pathname, active: false, lock: pathname }); await flush();
    assert.equal(fixture.ui.states[0].status, "blocked");
    assert.equal(fixture.ui.states[0].inline_reauth, true);
    const tree = fixture.render();
    const form = tree.children[0].children[0];
    assert.equal(form.props.requiredDestination, pathname); fixture.cleanup();
  }
});
test("le worker rouvre la PWA depuis / ou /redirect sans Internet et sert le document d'appel préparé", async () => {
  let fetches = 0;
  const context = vm.createContext({ AbortController, Headers, Request, Response, URL, clearTimeout, setTimeout, console,
    fetch: async () => { fetches++; throw new TypeError("network_unavailable"); },
    caches: { open: async () => ({ match: async (request) => new URL(typeof request === "string" ? request : request.url,
      "https://www.mon-cahier.com").pathname === "/class" ? new Response("prepared-class") :
      new URL(typeof request === "string" ? request : request.url, "https://www.mon-cahier.com").pathname === "/login"
        ? new Response("prepared-login") : undefined }) },
    self: { navigator: { onLine: false }, location: { origin: "https://www.mon-cahier.com" }, addEventListener() {} } });
  vm.runInContext(read("public/moncahier-sw.js"), context);
  for (const path of ["/", "/redirect"]) {
    assert.equal(vm.runInContext(`isOfflinePagePath('${path}')`, context), true);
    const response = await vm.runInContext(`navigationResponse(new Request(self.location.origin + '${path}'))`, context);
    assert.equal(response.status, 302); assert.equal(response.headers.get("location"), "https://www.mon-cahier.com/login?offline_resume=1");
  }
  const response = await vm.runInContext("navigationResponse(new Request(self.location.origin + '/class'))", context);
  assert.equal(await response.text(), "prepared-class"); assert.equal(fetches, 0);
  context.self.navigator.onLine = true;
  assert.equal((await vm.runInContext("navigationResponse(new Request(self.location.origin + '/'))", context)).status, 302);
  assert.equal(fetches, 1);
  const login = await vm.runInContext("navigationResponse(new Request(self.location.origin + '/login?offline_resume=1'))", context);
  assert.equal(await login.text(), "prepared-login");
  const reopened = await vm.runInContext("navigationResponse(new Request(self.location.origin + '/class'))", context);
  assert.equal(await reopened.text(), "prepared-class");
  assert.equal(fetches, 1, "le Wi-Fi sans WAN ne doit pas imposer trois timeouts au redémarrage");
});
