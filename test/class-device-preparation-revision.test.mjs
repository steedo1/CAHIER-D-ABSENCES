import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function evaluate(file, imports = {}) {
  const exports = {};
  new Function("exports", "require", compile(read(file)))(exports, (name) => {
    assert.ok(name in imports, name); return imports[name];
  });
  return exports;
}
const readinessSource = ts.createSourceFile("readiness.ts", read("src/lib/offline-readiness.ts"), ts.ScriptTarget.Latest, true);
function functionSource(name, source = readinessSource) {
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    else ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration, name);
  return declaration.getText(source);
}
function isolatedFunction(name, dependencies, additional = []) {
  return new Function(...Object.keys(dependencies), compile(
    [...additional, name].map((item) => functionSource(item)).join("\n") + `\nreturn ${name};`,
  ))(...Object.values(dependencies));
}
const { advanceClassDevicePreparation } = evaluate("src/lib/class-device-preparation-revision.ts");
const failures = evaluate("src/lib/offline-preparation-failure.ts");
const expected = { institutionId: "CSCA", classId: "TA", actorProfileId: "tablet-TA" };
const cloud = (revision = 110, preparation = 100) => ({ ok: true, institution_id: "CSCA", actor_profile_id: "tablet-TA", schedule_revision: revision, preparation_revision: preparation });
const bundle = () => ({
  readiness: { version: 5, role: "class-device", shell_ready: true, schedule_revision: 100,
    preparation_revision: 100, institution_id: "CSCA", authorized_class_id: "TA", authorized_actor_profile_id: "tablet-TA",
    prepared_at: "2026-10-09T06:30:00Z", data_presence: { students: 66, slots: 37 } },
  schedule: { institution_id: "CSCA", class_id: "TA", actor_profile_id: "tablet-TA", schedule_revision: 100,
    preparation_revision: 100, slots: [{ key: "1|07:15|08:10", items: [{ subject_id: "Allemand" }] }], rosters: { TA: { items: [{ id: "student" }] } } },
});

test("les nouveaux appels actualisent la confirmation Cloud sans changer le planning ou la liste préparés", () => {
  const before = bundle(); const after = advanceClassDevicePreparation(before, cloud(), expected, 110);
  assert.equal(after.readiness.schedule_revision, 110);
  assert.equal(after.schedule.schedule_revision, 110);
  assert.equal(after.readiness.preparation_revision, 100);
  assert.equal(after.readiness.prepared_at, before.readiness.prepared_at);
  assert.strictEqual(after.schedule.slots, before.schedule.slots);
  assert.strictEqual(after.schedule.rosters, before.schedule.rosters);
  assert.equal(before.schedule.schedule_revision, 100);
});

for (const [name, mutate] of [
  ["planning réellement modifié", (b, c) => { c.preparation_revision++; }],
  ["ancienne préparation sans preuve", (b) => { delete b.readiness.preparation_revision; }],
  ["ancien serveur", (b, c) => { delete c.preparation_revision; }],
  ["paquet et préparation incohérents", (b) => { b.schedule.preparation_revision++; }],
  ["autre classe", (b) => { b.schedule.class_id = "4e2"; }],
  ["autre compte", (b, c) => { c.actor_profile_id = "other"; }],
  ["autre établissement", (b, c) => { c.institution_id = "other"; }],
  ["application incomplète", (b) => { b.readiness.shell_ready = false; }],
  ["réponse plus ancienne", (b, c) => { c.schedule_revision = 99; }],
  ["révision invalide", (b, c) => { c.schedule_revision = NaN; }],
]) test(`aucune validation automatique avec ${name}`, () => {
  const b = bundle(), c = cloud(); mutate(b, c);
  assert.equal(advanceClassDevicePreparation(b, c, expected, null), null);
});
test("une confirmation antérieure à une révision déjà connue ne peut pas rétablir un vieux paquet", () => {
  assert.equal(advanceClassDevicePreparation(bundle(), cloud(), expected, 111), null);
});

test("la mise à jour atomique conserve les opérations locales et refuse une préparation ou un compte remplacés", async () => {
  const fakeSource = ts.createSourceFile("fake.ts", read("test/offline-outbox-ordering.test.ts"), ts.ScriptTarget.Latest, true);
  const restore = new Function(compile(functionSource("installFakeIndexedDb", fakeSource)) + "; return installFakeIndexedDb;")()();
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout, dispatchEvent() {} };
  try {
    let actor = expected.actorProfileId, generation = 1, changeDuringRead = false;
    const offline = evaluate("src/lib/offline.ts", {
      "@/lib/attendance-cache-contract": evaluate("src/lib/attendance-cache-contract.ts"),
      "@/lib/attendance-cache-identity": { attendanceAuthGeneration: () => generation,
        attendanceCacheActor: async () => { const result = actor; if (changeDuringRead) generation++; return result; } },
      "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
      "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
    });
    const key = "classDevice:offline:coherent-bundle:v1", before = bundle();
    const after = advanceClassDevicePreparation(before, cloud(), expected, 110);
    await offline.cacheSet(key, before);
    await offline.cacheSet("classDevice:last-completion:v1", { pending: true, session_id: "saved-call" });
    await offline.offlineMutateJson("/api/test-protected", { method: "POST", body: { value: "kept" } }, { queueOnly: true, operationId: "protected-action" });
    assert.equal(await offline.cacheCompareAndSet(key, before, after, actor, () => true), true);
    assert.deepEqual(await offline.cacheGet(key), after);
    assert.equal(await offline.cacheCompareAndSet(key, before, after, actor, () => true), false);
    const newer = { ...after, schedule: { ...after.schedule, schedule_revision: 120 } };
    await offline.cacheSet(key, newer);
    assert.equal(await offline.cacheCompareAndSet(key, after, before, actor, () => true), false);
    assert.equal(await offline.cacheCompareAndSet(key, newer, before, actor, () => false), false);
    changeDuringRead = true;
    assert.equal(await offline.cacheCompareAndSet(key, newer, before, actor, () => true), false);
    changeDuringRead = false; actor = "another-device";
    assert.equal(await offline.cacheCompareAndSet(key, newer, before, expected.actorProfileId, () => true), false);
    assert.deepEqual(await offline.cacheGet(key), newer);
    assert.deepEqual(await offline.cacheGet("classDevice:last-completion:v1"), { pending: true, session_id: "saved-call" });
    assert.equal((await offline.listOfflineOutboxEntries())[0].operationId, "protected-action");
  } finally { restore(); globalThis.window = previousWindow; }
});

for (const [error, shouldRetry] of [["schedule_changed_during_read", true], ["HTTP 503", true], ["Failed to fetch", true], ["HTTP 401", false], ["HTTP 403", false]]) {
  test(`téléchargement classe ${error} : reprise bornée et adaptée`, async () => {
    let calls = 0, writes = 0;
    const download = isolatedFunction("fetchClassPreparationAndCache", {
      window: { setTimeout: (fn) => fn() }, retryableOfflinePreparationFailure: failures.retryableOfflinePreparationFailure,
      fetchFreshJson: async () => { if (++calls === 1) throw new Error(error); return { items: ["saved"] }; },
      cacheSet: async () => { writes++; },
    });
    if (shouldRetry) { assert.deepEqual(await download("url", "key"), { items: ["saved"] }); assert.equal(calls, 2); assert.equal(writes, 1); }
    else { await assert.rejects(download("url", "key")); assert.equal(calls, 1); assert.equal(writes, 0); }
  });
}
test("un stockage plein ne redéclenche pas de téléchargements et ne produit pas une fausse réussite", async () => {
  let calls = 0;
  const download = isolatedFunction("fetchClassPreparationAndCache", {
    window: { setTimeout: (fn) => fn() }, retryableOfflinePreparationFailure: failures.retryableOfflinePreparationFailure,
    fetchFreshJson: async () => { calls++; return { items: [] }; },
    cacheSet: async () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); },
  });
  await assert.rejects(download("url", "key"), { name: "QuotaExceededError" }); assert.equal(calls, 1);
});

function preparationFixture() {
  if (process.env.CSCA_PREPARATION_FIXTURE_PATH) return JSON.parse(fs.readFileSync(process.env.CSCA_PREPARATION_FIXTURE_PATH, "utf8"));
  const periods = Array.from({ length: 37 }, (_, index) => ({ id: `period-${index}`, weekday: 1 + Math.floor(index / 8),
    start_time: `${String(7 + index % 8).padStart(2, "0")}:15:00`, end_time: `${String(8 + index % 8).padStart(2, "0")}:10:00`, label: "Séance" }));
  return { class_id: "TA", actor_profile_id: "tablet-TA", institution_id: "CSCA", student_count: 66,
    periods, subject_refs: periods.map((period, i) => ({ period: period.id, subject: `subject-${i % 9}` })) };
}
function cloudPreparation(finalOverrides = {}, initialOverrides = {}) {
  const fixture = preparationFixture(); const downloaded = [], confirmations = [];
  const finalStatus = { ...cloud(), institution_id: fixture.institution_id, actor_profile_id: fixture.actor_profile_id, ...finalOverrides };
  const build = isolatedFunction("buildClassDeviceScheduleFromCloud", {
    fetchFirstAndCache: async (options) => {
      assert.ok(options.every((option) => option.url.endsWith("?offline_preparation=v1")));
      return { periods: fixture.periods };
    },
    fetchClassPreparationAndCache: async (url) => {
      downloaded.push(url);
      if (url.startsWith("/api/class/roster")) return { items: Array.from({ length: fixture.student_count }, (_, i) => ({ id: `student-${i}` })) };
      assert.equal(new URL(url, "https://fixture.invalid").searchParams.get("offline_preparation"), "v1");
      const periodId = new URL(url, "https://fixture.invalid").searchParams.get("period_id");
      return { items: fixture.subject_refs.filter((item) => item.period === periodId).map((item) => ({ id: item.subject, label: "Matière" })) };
    },
    fetchFreshJson: async () => finalStatus,
    observeScheduleRevision: () => {}, rememberCloudScheduleStatus: async (value) => { confirmations.push(value); },
    classDeviceReadinessMessage: (value) => value,
  }, ["safeRevision", "classDevicePeriodTime", "classDevicePeriodKey", "mapLimit"]);
  return { fixture, downloaded, confirmations, run: () => build({ institutionId: fixture.institution_id, classId: fixture.class_id,
    actorProfileId: fixture.actor_profile_id, selectedClass: { label: "TA", level: "TA" }, scheduleRevision: 100,
    preparationRevision: 100, generatedAt: null, onProgress: () => {}, ...initialOverrides }) };
}
test("37 créneaux et 66 élèves : la préparation Cloud aboutit pendant des appels d'autres classes, sans relais", async () => {
  const f = cloudPreparation(); const schedule = await f.run();
  assert.equal(f.fixture.periods.length, 37); assert.equal(f.fixture.student_count, 66);
  assert.equal(f.downloaded.length, 38);
  assert.equal(schedule.schedule_revision, 110); assert.equal(schedule.preparation_revision, 100);
  assert.equal(schedule.rosters[f.fixture.class_id].items.length, 66);
  assert.equal(schedule.slots.length, new Set(f.fixture.subject_refs.map((item) => item.period)).size);
  assert.equal(schedule.source, "cloud"); assert.equal(schedule.relay_time, null);
  assert.equal(f.confirmations.length, 1);
});
for (const [name, final, initial] of [
  ["planning modifié", { preparation_revision: 101 }, {}],
  ["compte remplacé", { actor_profile_id: "other" }, {}],
  ["établissement remplacé", { institution_id: "other" }, {}],
  ["révision manquante", { schedule_revision: null }, {}],
  ["ancien serveur : contrôle strict conservé", {}, { preparationRevision: null }],
]) test(`préparation refusée avec ${name}`, async () => {
  const f = cloudPreparation(final, initial); await assert.rejects(f.run(), /schedule_changed_during_prepare/);
  assert.equal(f.confirmations.length, 0);
});
test("les causes sont expliquées sur le bouton Réessayer sans exposer les erreurs brutes", () => {
  assert.match(failures.offlinePreparationFailureMessage(new Error("HTTP 403 forbidden")), /compte/);
  assert.match(failures.offlinePreparationFailureMessage(new Error("HTTP 401 unauthorized")), /même compte/);
  assert.match(failures.offlinePreparationFailureMessage(Object.assign(new Error("full"), { name: "QuotaExceededError" })), /sans effacer/);
  assert.match(failures.offlinePreparationFailureMessage(new Error("schedule_changed_during_prepare")), /planning/);
});

test("une ancienne réponse de contrôle Cloud ne remplace pas la confirmation finale plus récente", async () => {
  let complete;
  const api = evaluate("src/lib/cloud-availability.ts", { "@/lib/attendance-cache-identity": {
    attendanceCacheActor: async () => "tablet-TA", observeScheduleRevision: () => {},
  } });
  const previousFetch = globalThis.fetch, previousWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = () => new Promise((resolve) => { complete = resolve; });
  try {
    const pending = api.probeCloudSchedule();
    await new Promise((resolve) => setImmediate(resolve));
    await api.rememberCloudScheduleStatus({ ...cloud(), generated_at: "now", web_release: "test" });
    complete(Response.json({ ...cloud(100), generated_at: "earlier", web_release: "test" }));
    assert.equal((await pending).schedule_revision, 110);
    assert.equal((await api.probeCloudSchedule()).schedule_revision, 110);
  } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
});

const serverRevisions = evaluate("src/lib/attendance-schedule-revision-server.ts");
function revisionService(preparation = 100) {
  let reads = 0;
  return { from: () => ({ select() { return this; }, eq() { return this; },
    async maybeSingle() { reads++; return { data: { revision: reads === 1 ? 100 : 110,
      preparation_revision: reads === 1 ? 100 : preparation }, error: null }; } }) };
}
for (const [name, preparing, changed, status] of [
  ["nouveaux appels pendant la préparation", true, false, 200],
  ["planning modifié pendant la préparation", true, true, 409],
  ["contrat historique conservé", false, false, 409],
]) test(`matières : ${name}`, async () => {
  const source = ts.createSourceFile("subjects.ts", read("src/app/api/class/subjects/route.ts"), ts.ScriptTarget.Latest, true);
  const srv = revisionService(changed ? 101 : 100);
  const initial = await serverRevisions.readAttendancePreparationSnapshot(srv, "CSCA");
  const dependencies = {
    srv, institutionId: "CSCA", preparingOffline: preparing, scheduleRevision: initial.schedule_revision,
    revisionRow: { preparation_revision: initial.preparation_revision },
    scheduleMeta: { institution_id: "CSCA", class_id: "TA", schedule_revision: initial.schedule_revision },
    ...serverRevisions, NextResponse: { json: (body, options) => Response.json(body, options) },
  };
  const respond = new Function(...Object.keys(dependencies), compile(functionSource("scheduleJson", source)) + "; return scheduleJson;")(...Object.values(dependencies));
  const response = await respond([{ id: "Allemand" }]); assert.equal(response.status, status);
  if (status === 200) { const payload = await response.json(); assert.equal(payload.schedule_revision, 110); assert.equal(payload.preparation_revision, 100); }
});

for (const [name, preparing, changed, status] of [
  ["nouveaux appels pendant la préparation", true, false, 200],
  ["planning modifié pendant la préparation", true, true, 409],
  ["contrat professeur historique conservé", false, false, 409],
]) test(`créneaux : ${name}`, async () => {
  const revisions = revisionService(changed ? 101 : 100);
  const tables = { profiles: { institution_id: "CSCA" }, institutions: { tz: "Africa/Abidjan" },
    institution_periods: preparationFixture().periods, user_roles: [{ role: "class_device" }],
    institution_attendance_policies: {}, institution_attendance_zones: [], relay_sync_devices: [] };
  const service = { from(table) {
    if (table === "attendance_schedule_revisions") return revisions.from(table);
    assert.ok(table in tables, table);
    return { select() { return this; }, eq() { return this; }, order() { return this; }, is() { return this; },
      maybeSingle: async () => ({ data: tables[table], error: null }),
      then(resolve, reject) { return Promise.resolve({ data: tables[table], error: null }).then(resolve, reject); } };
  } };
  const api = evaluate("src/app/api/teacher/institution/basics/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => ({ ...service,
      auth: { getUser: async () => ({ data: { user: { id: "tablet-TA" } }, error: null }) } }) },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/attendance-presence-server": { createRelayAttendanceAccessToken: () => null },
    "@/lib/relay-endpoints": { relayEndpointCandidates: () => [] },
    "@/lib/attendance-schedule-revision-server": serverRevisions,
  });
  const response = await api.GET(new Request(`https://fixture.invalid/api/teacher/institution/basics${preparing ? "?offline_preparation=v1" : ""}`));
  assert.equal(response.status, status);
  if (status === 200) {
    const payload = await response.json(); assert.equal(payload.schedule_revision, 110);
    assert.equal(payload.periods.length, 37); assert.equal(payload.attendance_presence.allow_local_relay, false);
  }
});
