import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function evaluate(source, imports = {}) {
  const exports = {};
  new Function("exports", "require", compile(source))(exports, (name) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  });
  return exports;
}
const contract = evaluate(read("src/lib/attendance-cache-contract.ts"));
const fakeSource = ts.createSourceFile("fake.ts", read("test/offline-outbox-ordering.test.ts"), ts.ScriptTarget.Latest, true);
const fakeFunction = fakeSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "installFakeIndexedDb");
const installFake = new Function(compile(fakeFunction.getText(fakeSource)) + "; return installFakeIndexedDb;")();
const slot = "teacher:classes:1|09:05|10:00";
const scope = (actor = "A", revision = 1, institution = "CSCA") => ({
  institution_id: institution, actor_profile_id: actor, schedule_revision: revision,
});
async function fixture(source = process.env.CACHE_TEST_BASELINE === "1"
  ? execFileSync("git", ["show", "941463c0:src/lib/offline.ts"], { cwd: root, encoding: "utf8" })
  : read("src/lib/offline.ts")) {
  installFake();
  globalThis.window = { setTimeout, clearTimeout, dispatchEvent() {} };
  let actor = "A", generation = 0;
  const revisions = new Map();
  const identity = {
    attendanceCacheActor: async () => actor,
    attendanceAuthGeneration: () => generation,
    knownScheduleRevision: (inst) => revisions.get(inst) ?? null,
    observeScheduleRevision: (inst, revision) => revisions.set(inst, Math.max(revision, revisions.get(inst) ?? 0)),
  };
  const api = evaluate(source, {
    "@/lib/attendance-cache-contract": contract,
    "@/lib/attendance-cache-identity": identity,
    "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
    "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
  });
  return { ...api, identity, switchActor(value) { actor = value; generation++; },
    async prepare(user = actor, revision = 1, subject = "EPS", institution = "CSCA") {
      await api.cacheSetMany([
        ["teacher:offline:bootstrap", { ...scope(user, revision, institution), slots: [{ key: slot, items: [subject] }] }],
        ["teacher:inst:basics", { ...scope(user, revision, institution), periods: [revision] }],
        ["offline:readiness:teacher", { ...scope(user, revision, institution), ready: true }],
        [slot, { ...scope(user, revision, institution), items: [subject] }],
        ["teacher:roster:5e2", { items: [`roster-${revision}`] }],
      ]);
    },
  };
}

test("reproduit le bug réel avant correction : B relit EPS de A après timeout", async () => {
  const baseline = execFileSync("git", ["show", "941463c0:src/lib/offline.ts"], { cwd: root, encoding: "utf8" });
  const api = await fixture(baseline);
  await api.prepare();
  api.switchActor("B");
  globalThis.fetch = async () => { throw new TypeError("network timeout"); };
  assert.deepEqual((await api.offlineGetJson("/api/teacher/classes", slot)).items, ["EPS"]);
});

test("A puis B : aucun cache de A, y compris bootstrap, paramètres et readiness", async () => {
  const api = await fixture(); await api.prepare(); api.switchActor("B");
  for (const key of [slot, "teacher:offline:bootstrap", "teacher:inst:basics", "offline:readiness:teacher", "teacher:roster:5e2"])
    assert.equal(await api.cacheGet(key), null, key);
});

for (const failure of ["timeout", "offline", "500", "503"]) {
  test(`réseau ${failure} : secours exact du même compte, jamais d'un autre`, async () => {
    const api = await fixture(); await api.prepare();
    globalThis.fetch = async () => {
      if (/^5/.test(failure)) return new Response("{}", { status: Number(failure) });
      throw new TypeError(failure);
    };
    assert.deepEqual((await api.offlineGetJson("/api/teacher/classes", slot)).items, ["EPS"]);
    api.switchActor("B");
    await assert.rejects(api.offlineGetJson("/api/teacher/classes", slot));
  });
}

test("logout puis login B et retour A : les comptes restent isolés sans supprimer les appels", async () => {
  const api = await fixture(); await api.prepare();
  await api.cacheSet("teacher:attendance-delivery:v1:CSCA", [{ pending: true }]);
  api.switchActor(null); assert.equal(await api.cacheGet(slot), null);
  api.switchActor("B"); await api.prepare("B", 1, "Français");
  assert.deepEqual((await api.cacheGet(slot)).items, ["Français"]);
  api.switchActor("A"); assert.deepEqual((await api.cacheGet(slot)).items, ["EPS"]);
  assert.deepEqual(await api.cacheGet("teacher:attendance-delivery:v1:CSCA"), [{ pending: true }]);
});

test("nouvelle révision : toutes les anciennes projections deviennent inaccessibles", async () => {
  const api = await fixture(); await api.prepare();
  api.identity.observeScheduleRevision("CSCA", 2);
  for (const key of [slot, "teacher:offline:bootstrap", "teacher:inst:basics", "offline:readiness:teacher", "teacher:roster:5e2"])
    assert.equal(await api.cacheGet(key), null, key);
  await api.prepare("A", 2, "EPS actualisée");
  assert.deepEqual((await api.cacheGet(slot)).items, ["EPS actualisée"]);
  assert.deepEqual((await api.cacheGet("teacher:roster:5e2")).items, ["roster-2"]);
  await assert.rejects(api.prepare("A", 1, "Informatique"), /stale/);
});

test("changement de compte pendant la réponse : aucune publication ni retour du payload", async () => {
  const api = await fixture(); await api.prepare();
  globalThis.fetch = async () => { api.switchActor("B"); return Response.json({ ...scope(), items: ["EPS"] }); };
  await assert.rejects(api.offlineGetJson("/api/teacher/classes", slot), /identity_changed/);
  assert.equal(await api.cacheGet(slot), null);
});

test("nouvelle révision pendant le timeout : aucune reprise du vieux cache", async () => {
  const api = await fixture(); await api.prepare();
  globalThis.fetch = async () => { api.identity.observeScheduleRevision("CSCA", 2); throw new TypeError("timeout"); };
  await assert.rejects(api.offlineGetJson("/api/teacher/classes", slot));
});

test("coupure puis retour Internet : remplacement par la nouvelle révision Cloud", async () => {
  const api = await fixture(); await api.prepare();
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  assert.deepEqual((await api.offlineGetJson("/api/teacher/classes", slot)).items, ["EPS"]);
  globalThis.fetch = async () => Response.json({ ...scope("A", 2), items: ["EPS officielle"] });
  assert.deepEqual((await api.offlineGetJson("/api/teacher/classes", slot)).items, ["EPS officielle"]);
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  assert.deepEqual((await api.offlineGetJson("/api/teacher/classes", slot)).items, ["EPS officielle"]);
});

test("réponse d'un autre professeur et erreurs 401/403 ne deviennent pas un cache", async () => {
  const api = await fixture(); await api.prepare();
  globalThis.fetch = async () => Response.json({ ...scope("B"), items: ["Informatique"] });
  await assert.rejects(api.offlineGetJson("/api/teacher/classes", slot), /identity_mismatch/);
  for (const status of [401, 403]) {
    globalThis.fetch = async () => new Response("{}", { status });
    await assert.rejects(api.offlineGetJson("/api/teacher/classes", slot));
  }
});

test("une réponse sans contrat de révision n'est jamais promue dans le cache courant", async () => {
  const api = await fixture(); await api.prepare();
  globalThis.fetch = async () => Response.json({ items: ["Informatique ancienne"] });
  await assert.rejects(api.offlineGetJson("/api/teacher/classes", slot), /contract_missing/);
  assert.deepEqual((await api.cacheGet(slot)).items, ["EPS"]);
});

test("rechargement : les clés physiques ne dépendent ni de la session mémoire ni du navigateur", () => {
  const a = contract.teacherCacheKey(slot, scope());
  assert.equal(a, contract.teacherCacheKey(slot, JSON.parse(JSON.stringify(scope()))));
  for (const other of [scope("B"), scope("A", 2), scope("A", 1, "AUTRE")])
    assert.notEqual(a, contract.teacherCacheKey(slot, other));
});

for (const cloudRevision of [1, null, 2]) {
  test(`établissement SANS relais : révision Cloud ${cloudRevision}, zéro accès au relais`, async () => {
    const api = await fixture(); await api.prepare();
    const source = read("src/lib/offline-readiness.ts");
    const ast = ts.createSourceFile("readiness.ts", source, ts.ScriptTarget.Latest, true);
    const imports = Object.fromEntries(ast.statements.filter(ts.isImportDeclaration)
      .map((node) => [node.moduleSpecifier.text, {}]));
    Object.assign(imports, {
      "@/lib/offline": { ...api, MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1, getActiveOfflineWorkerInfo: async () => null },
      "@/lib/cloud-availability": { probeCloudSchedule: async () => cloudRevision === null ? null : ({ institution_id: "CSCA", schedule_revision: cloudRevision }) },
      "@/lib/relay-capability": { relayEnabledForInstitution: () => false },
      "@/lib/local-relay": { checkRelayTeacherConnectivity: async () => { assert.fail("aucun relais dans cet établissement"); } },
    });
    const readiness = evaluate(source, imports);
    const assessment = await readiness.assessTeacherOfflineReadiness({
      version: 5, role: "teacher", schedule_revision: 1, offline_schema_version: 1,
      institution_id: "CSCA", actor_profile_id: "A", slot_count: 1,
      data_presence: { slots: 1, classes: 1 },
    });
    assert.equal(assessment.status, cloudRevision === 2 ? "phone_stale" : "ready");
    assert.doesNotMatch(assessment.message, /relais/i);
  });
}

test("le worker ne fait plus passer l'ancien cache de matière pour une réponse Cloud", () => {
  const worker = read("public/moncahier-sw.js");
  const fn = worker.slice(worker.indexOf("async function classDeviceSubjectsResponse"), worker.indexOf("async function navigationResponse"));
  assert.doesNotMatch(fn, /readOfflineKv/);
  assert.match(fn, /503/);
});
