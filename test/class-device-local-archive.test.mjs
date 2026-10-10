import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  const source = ts.createSourceFile("fixture.ts", read("test/offline-outbox-ordering.test.ts"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "installFakeIndexedDb");
  const restoreDb = new Function(`${compile(declaration.getText(source))}; return installFakeIndexedDb;`)()();
  const exports = {};
  const imports = {
    "@/lib/attendance-cache-contract": { isTeacherCacheKey: () => false, isTeacherScheduleKey: () => false },
    "@/lib/attendance-cache-identity": { attendanceAuthGeneration: () => 1 },
    "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
    "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
  };
  new Function("exports", "require", compile(read("src/lib/offline.ts")) + "\nexports.testDb = openDB;")(exports, (name) => {
    assert.ok(name in imports, name); return imports[name];
  });
  const oldFetch = globalThis.fetch;
  const paths = { "session-start": "/api/class/sessions/start", attendance: "/api/teacher/attendance/bulk", "session-end": "/api/class/sessions/end" };
  return { offline: exports, restore() { globalThis.fetch = oldFetch; restoreDb(); },
    async queue(id, type, session = "client:old-start", extra = {}) {
      return exports.offlineMutateJson(paths[type] || "/api/other/save", {
        method: type === "session-end" ? "PATCH" : "POST",
        body: type === "session-start" ? { client_session_id: session, class_id: "3e1" } : { session_id: session, marks: [], actual_end_at: "2026-10-08T03:25:11Z" },
        headers: { Authorization: "secret", "Content-Type": "application/json" },
      }, { queueOnly: true, operationId: id, meta: { operationType: type, institutionId: "csca", classId: "3e1" }, ...extra });
    },
  };
}

test("abandonner un ancien essai regroupe la séance, sauvegarde les appels et conserve les autres données", async () => {
  const f = fixture();
  try {
    const o = f.offline;
    await o.registerOfflineSessionReference("client:old-start", "old-cloud-session");
    await f.queue("old-start", "session-start");
    await f.queue("old-attendance", "attendance", "old-cloud-session");
    await f.queue("old-end", "session-end");
    await f.queue("real-attendance", "attendance", "real-cloud-session");
    await f.queue("other-data", "other", "other-session");
    await o.putDurableAttendanceRecord("attendance-delivery", { operation_id: "journal-only", institution_id: "csca", session_id: "old-cloud-session", class_id: "3e1", created_at: "2026-10-08T03:20:00Z", state: "blocked", marks: [{ student_id: "student-1", status: "absent" }] });
    await o.putDurableAttendanceRecord("attendance-delivery", { operation_id: "real-journal", institution_id: "csca", session_id: "real-cloud-session", state: "device_pending", marks: [] });
    const preparation = { prepared_at: "2026-10-10T06:30:00Z", class_id: "TA", slots: ["German"], students: ["student"] };
    await o.cacheSet("classDevice:coherent-bundle:v1", preparation);
    await o.cacheSet("classDevice:last-completion:v1", { session_id: "old-cloud-session" });
    await o.cacheSet("classDevice:local-open", { id: "real-cloud-session", class_id: "TA" });
    await o.cacheSet("classDevice:pending-end", { client_session_id: "client:old-start", actual_end_at: "2026-10-08T03:25:11Z" });
    globalThis.fetch = () => { throw new Error("archive must never send a request"); };
    const preview = await o.previewOfflineCallArchive(["old-end"]);
    assert.deepEqual(preview.operationIds, ["journal-only", "old-attendance", "old-end", "old-start"]);
    assert.equal(preview.outboxCount, 3);
    const archived = await o.archiveOfflineCalls(preview);
    assert.equal(archived.operationCount, 4);
    assert.deepEqual((await o.listOfflineOutboxEntries()).map((row) => row.operationId).sort(), ["other-data", "real-attendance"]);
    assert.deepEqual(await o.cacheGet("classDevice:coherent-bundle:v1"), preparation);
    assert.deepEqual(await o.cacheGet("classDevice:local-open"), { id: "real-cloud-session", class_id: "TA" });
    assert.equal(await o.cacheGet("classDevice:last-completion:v1"), null);
    assert.equal(await o.cacheGet("classDevice:pending-end"), null);
    assert.deepEqual((await o.cacheGet("teacher:attendance-delivery:v1:csca")).map((record) => record.operation_id), ["real-journal"]);
    const backup = await o.readOfflineCallArchive(archived.id);
    assert.equal(backup.outbox.length, 3);
    assert.equal(backup.journals[0].value[0].marks[0].status, "absent");
    assert.equal(backup.markers.length, 2);
    assert.doesNotMatch(JSON.stringify(backup), /secret|Authorization/);
    assert.equal((await o.resolveOfflineSessionReference("client:old-start")).serverSessionId, "old-cloud-session");
  } finally { f.restore(); }
});

test("les écritures tardives et le prochain Envoyer ne recréent pas les actions archivées", async () => {
  const f = fixture();
  try {
    const o = f.offline;
    await f.queue("old-attendance", "attendance");
    await o.archiveOfflineCalls(await o.previewOfflineCallArchive(["old-attendance"]));
    await o.putDurableAttendanceRecord("attendance-delivery", { operation_id: "old-attendance", institution_id: "csca", state: "blocked" });
    assert.equal(await o.cacheGet("teacher:attendance-delivery:v1:csca"), null);
    let sent = 0;
    globalThis.fetch = async () => { sent++; return Response.json({}); };
    const result = await f.queue("old-attendance", "attendance", "client:old-start", { queueOnly: false });
    assert.equal(result.queued, false);
    assert.equal(result.error, "offline_operation_archived");
    assert.equal(sent, 0);
    assert.equal((await o.listOfflineOutboxEntries()).length, 0);
  } finally { f.restore(); }
});

test("une réponse réseau tardive ne remet pas l’action retirée dans la file", async () => {
  const f = fixture();
  try {
    await f.queue("old-attendance", "attendance");
    let release, started;
    const entered = new Promise((resolve) => { started = resolve; });
    globalThis.fetch = () => { started(); return new Promise((_, reject) => { release = reject; }); };
    const late = f.queue("old-attendance", "attendance", "client:old-start", { queueOnly: false });
    await entered;
    await f.offline.archiveOfflineCalls(await f.offline.previewOfflineCallArchive(["old-attendance"]));
    release(new Error("Failed to fetch"));
    const result = await late;
    assert.equal(result.queued, false);
    assert.equal(result.error, "offline_operation_archived");
    assert.equal((await f.offline.listOfflineOutboxEntries()).length, 0);
  } finally { f.restore(); }
});

test("un appel ajouté à la même séance après validation impose une nouvelle sélection", async () => {
  const f = fixture();
  try {
    await f.queue("old-attendance", "attendance");
    const preview = await f.offline.previewOfflineCallArchive(["old-attendance"]);
    await f.queue("new-end", "session-end");
    await assert.rejects(f.offline.archiveOfflineCalls(preview), /changé/);
    assert.equal((await f.offline.listOfflineOutboxEntries()).length, 2);
  } finally { f.restore(); }
});

test("une sauvegarde locale impossible conserve toutes les opérations", async () => {
  const f = fixture();
  try {
    await f.queue("old-attendance", "attendance");
    const preview = await f.offline.previewOfflineCallArchive(["old-attendance"]);
    const db = await f.offline.testDb();
    // Inject a browser quota failure at the backup write, before any removal.
    const priorTransaction = db.transaction;
    db.transaction = (...args) => {
      const tx = priorTransaction(...args);
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = (name) => {
        const store = objectStore(name);
        const put = store.put;
        store.put = (row) => {
          if (row.key?.startsWith("classDevice:sync-archive:v1:")) throw new DOMException("quota", "QuotaExceededError");
          return put(row);
        };
        return store;
      };
      return tx;
    };
    await assert.rejects(f.offline.archiveOfflineCalls(preview), { name: "QuotaExceededError" });
    assert.equal((await f.offline.listOfflineOutboxEntries()).length, 1);
    assert.equal((await f.offline.readOfflineCallArchive("missing")), null);
  } finally { f.restore(); }
});

test("le retrait refuse les écritures hors appel et les identifiants inconnus", async () => {
  const f = fixture();
  try {
    await f.queue("other-data", "other");
    await assert.rejects(f.offline.previewOfflineCallArchive(["other-data"]), /Seules/);
    await assert.rejects(f.offline.previewOfflineCallArchive(["missing"]), /liste a changé/);
    assert.equal((await f.offline.listOfflineOutboxEntries()).length, 1);
  } finally { f.restore(); }
});

test("un nouvel appel réel conservé s’envoie après le retrait des anciens essais", async () => {
  const f = fixture();
  try {
    const o = f.offline;
    await f.queue("old-attendance", "attendance");
    await f.queue("real-attendance", "attendance", "real-cloud-session");
    await o.archiveOfflineCalls(await o.previewOfflineCallArchive(["old-attendance"]));
    const sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push(init.headers["X-Mon-Cahier-Operation-Id"]);
      return Response.json({ ok: true, operation_id: "real-attendance" });
    };
    const result = await o.flushOutbox();
    assert.deepEqual(sent, ["real-attendance"]);
    assert.equal(result.flushed, 1);
    assert.equal(result.remaining, 0);
  } finally { f.restore(); }
});
