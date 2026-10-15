import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, imports = {}) {
  const exports = {};
  new Function("exports", "require", ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(exports, (name) => { assert.ok(name in imports, name); return imports[name]; });
  return exports;
}
const state = load("src/lib/class-device-sync-state.ts");
const scope = { id: "TA", institution_id: "csca", actor_profile_id: "phone-a" };
const other = { id: "3e1", institution_id: "csca", actor_profile_id: "phone-b" };
const entry = (id, cls = scope, blocked = false) => ({
  id, operationId: id, operationType: "attendance", sessionDependencyKey: `session-${id}`,
  meta: { classId: cls.id, institutionId: cls.institution_id, actorProfileId: cls.actor_profile_id },
  state: blocked ? "blocked" : "pending", createdAt: 1, lastError: blocked ? "forbidden" : null,
});
function fixture() {
  const cache = new Map([["classDevice:my-classes", { items: [scope] }]]);
  const journals = { opens: [], attendance: [], lifecycle: [] };
  let entries = [], requests = [], flushes = [];
  const api = load("src/lib/class-device-sync-reconcile-v2.ts", {
    "@/lib/class-device-sync-state": state,
    "@/lib/offline": {
      cacheGet: async (key) => cache.get(key) || null,
      listOfflineOutboxEntries: async () => entries,
      isOfflineClassCallArchived: async (value) => Boolean(value.archived),
      flushOutbox: async (options) => {
        flushes.push(options);
        return { flushed: 0, remaining: 1, acknowledged: [] };
      },
    },
    "@/lib/attendance-network": { fetchAttendanceBackground: async (url, init) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return Response.json(url.includes("my-classes") ? { items: [scope] } : { ok: true, results: [] });
    } },
    "@/lib/teacher-session-delivery": { listTeacherSessionOpenOperations: async () => journals.opens },
    "@/lib/teacher-attendance-delivery": { listTeacherAttendanceOperations: async () => journals.attendance },
    "@/lib/teacher-session-lifecycle-delivery": { listTeacherSessionLifecycleOperations: async () => journals.lifecycle },
  });
  return { api, cache, journals, requests, flushes, setEntries(value) { entries = value; } };
}

test("changing class excludes old actions, completion and open markers without deleting them", async () => {
  const f = fixture();
  const stored = [entry("old", other, true), entry("ambiguous", { id: "", institution_id: "csca" }, true)];
  f.setEntries(stored);
  f.cache.set("classDevice:last-completion:v1", { class_id: other.id, session_id: "old", relay_state: "device_pending" });
  f.cache.set("classDevice:local-open", { class_id: other.id, id: "client:old", delivery_origin: "local_pending" });
  const current = await f.api.getClassDeviceLocalSyncStatus(scope);
  assert.equal(current.total, 0);
  assert.equal(current.blocked, 0);
  assert.equal(current.completion, null);
  assert.equal(current.localOpen, null);
  for (let i = 0; i < 720; i++) await f.api.repairClassDeviceSyncV2({ scope });
  assert.equal(f.requests.length, 0, "old classes cannot trigger endless Cloud requests");
  assert.equal(stored.length, 2, "other-class and unassigned historical actions stay stored");
});

test("an outbox action and its durable record count once and remain visible in details", async () => {
  const f = fixture();
  f.setEntries([entry("call", scope, true), entry("old", other, true)]);
  f.journals.attendance.push({ operation_id: "call", class_id: scope.id, institution_id: scope.institution_id,
    state: "blocked", session_id: "session-call", session_reference: "session-call", marks: [] });
  f.journals.opens.push({ operation_id: "journal-only", class_id: scope.id, institution_id: scope.institution_id,
    state: "blocked", session_id: null });
  const current = await f.api.getClassDeviceLocalSyncStatus(scope);
  assert.equal(current.total, 2);
  assert.equal(current.blocked, 2);
  assert.equal(current.retryable, false);
  assert.deepEqual(current.entries.map((row) => row.operationId), ["call"]);
  assert.deepEqual(current.operations.map((row) => row.operationId).sort(), ["call", "journal-only"]);
  assert.equal(state.classDeviceFriendlySyncState({ ...current, online: true, syncing: true }), "needs_attention");
});

test("unconfirmed calls are shown as waiting between real attempts, including with an empty outbox", async () => {
  const f = fixture();
  f.cache.set("classDevice:last-completion:v1", { class_id: scope.id, session_id: "session", relay_state: "device_pending" });
  const current = await f.api.getClassDeviceLocalSyncStatus(scope);
  assert.equal(state.classDeviceFriendlySyncState({ ...current, online: true, syncing: false }), "saved_on_device");
  assert.equal(state.classDeviceFriendlySyncState({ ...current, online: true, syncing: true }), "syncing");
  assert.equal(state.classDeviceFriendlySyncState({ ...current, online: false, syncing: true }), "saved_on_device");
  f.cache.set("classDevice:last-completion:v1", { ...current.completion, archived: true });
  const archived = await f.api.getClassDeviceLocalSyncStatus(scope);
  assert.equal(archived.completion, null);
  assert.equal(state.classDeviceFriendlySyncState({ ...archived, online: true, syncing: false }), "ready");
});

test("a pending queued retry remains sendable despite an older blocked durable state", async () => {
  const f = fixture();
  f.setEntries([entry("retry")]);
  f.journals.attendance.push({ operation_id: "retry", class_id: scope.id, institution_id: scope.institution_id,
    state: "blocked", session_id: "session-retry", session_reference: "session-retry", marks: [] });
  const current = await f.api.getClassDeviceLocalSyncStatus(scope);
  assert.equal(current.total, 1);
  assert.equal(current.blocked, 0);
  assert.equal(current.retryable, true);
});

test("a pending current action takes priority over an older Cloud-confirmed completion", async () => {
  assert.equal(state.classDeviceFriendlySyncState({ online: true, syncing: false, total: 1, blocked: 0,
    completion: { relay_state: "cloud_confirmed" } }), "saved_on_device");
  assert.equal(state.classDeviceFriendlySyncState({ online: true, syncing: false, total: 0, blocked: 0,
    completion: { relay_state: "cloud_confirmed" } }), "synced");
  assert.equal(state.classDeviceFriendlySyncState({ online: true, syncing: false, total: 0, blocked: 0,
    completion: { relay_state: "relay_confirmed" } }), "secured_on_relay");
  assert.equal(state.classDeviceRecordInScope({ class_id: scope.id, actor_profile_id: "another-user" }, scope), false);
});

test("recovery sends and counts only actions of the selected class", async () => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  try {
    const f = fixture();
    f.setEntries([entry("current"), entry("old", other, true)]);
    f.cache.set("classDevice:last-completion:v1", { class_id: other.id, session_id: "old", relay_state: "device_pending" });
    const result = await f.api.repairClassDeviceSyncV2({ scope });
    assert.equal(result.before, 1);
    assert.equal(result.after, 1);
    assert.equal(result.blocked, 0);
    assert.equal(result.completion_pending, false);
    assert.deepEqual(f.flushes[0].includeOperationIds, ["current"]);
    assert.ok(f.requests.filter((row) => row.body).every((row) => row.body.class_id === scope.id));
    assert.ok(f.requests.filter((row) => row.body).every((row) => row.body.operations.every((op) => op.operation_id === "current")));
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  }
});

test("the rendered badge stops spinning after a failed attempt and clears immediately after an archive", async () => {
  const { Window } = await import("happy-dom");
  const React = await import("react");
  const runtime = await import("react/jsx-runtime");
  const browser = new Window({ url: "https://example.invalid/class" });
  const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const old = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? browser : browser[key] });
  let root;
  try {
    const { createRoot } = await import("react-dom/client");
    let current = { total: 1, blocked: 0, retryable: true, localOpen: null, operations: [],
      completion: { relay_state: "device_pending" } };
    let release;
    let repairs = 0;
    const Guard = load("src/app/class/ClassDeviceSyncGuard.tsx", {
      react: React, "react/jsx-runtime": runtime,
      "next/link": { default: ({ href, children, ...props }) => React.createElement("a", { ...props, href }, children) },
      "@/lib/class-device-sync-state": state,
      "@/lib/class-device-sync-reconcile-v2": {
        getClassDeviceLocalSyncStatus: async () => current,
        repairClassDeviceSyncV2: async () => { repairs++; return new Promise((resolve) => { release = resolve; }); },
      },
    }).default;
    const host = browser.document.createElement("div"); browser.document.body.append(host);
    root = createRoot(host);
    await React.act(async () => { root.render(React.createElement(Guard, { scope })); });
    assert.equal(repairs, 1);
    assert.match(host.textContent, /Synchronisation en cours/);
    await React.act(async () => { release({ before: 1, after: 1, flushed: 0, reconciled: 0, completion_pending: true }); });
    assert.doesNotMatch(host.textContent, /Synchronisation en cours/);
    assert.match(host.textContent, /En attente d’envoi/);
    current = { ...current, blocked: 1, retryable: false };
    await React.act(async () => { browser.dispatchEvent(new browser.Event("class-device-sync-updated")); });
    assert.match(host.textContent, /1 action\(s\) à vérifier/);
    assert.equal(host.querySelector("a").getAttribute("href"), "/class/recover-sync-v2?class_id=TA");
    current = { total: 0, blocked: 0, retryable: false, localOpen: null, completion: null };
    await React.act(async () => { browser.dispatchEvent(new browser.Event("class-device-sync-updated")); });
    assert.match(host.textContent, /Prêt/);
    assert.doesNotMatch(host.textContent, /action\(s\) à vérifier|Synchronisation en cours/);
    assert.equal(repairs, 1, "a display refresh does not restart the network pipeline");
  } finally {
    if (root) await React.act(async () => root.unmount());
    browser.happyDOM.abort();
    globals.forEach((key, i) => { if (old[i]) Object.defineProperty(globalThis, key, old[i]); else delete globalThis[key]; });
  }
});
