// Navigateur + vrai service worker + vrai IndexedDB ; Cloud entièrement synthétique.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
import ts from "typescript";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = (file) => ts.transpileModule(read(file), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const bundle = `const contract={}; new Function('exports',${JSON.stringify(compile("src/lib/attendance-cache-contract.ts"))})(contract);
const api={}; new Function('exports','require',${JSON.stringify(compile("src/lib/offline.ts"))})(api,name=>({
  '@/lib/attendance-cache-contract':contract,
  '@/lib/attendance-cache-identity':{attendanceCacheActor:async()=>'synthetic-device',attendanceAuthGeneration:()=>1,knownScheduleRevision:()=>1,observeScheduleRevision(){}},
  '@/lib/offline-release':{MON_CAHIER_OFFLINE_SCHEMA_VERSION:1},
  '@/lib/grade-write-capabilities':{isOfflineGradeMutation:()=>false}
})[name]); window.audit=api;`;
const html = '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Audit PWA isolé</title><h1>Scénario synthétique Mon Cahier</h1><script src="/_next/static/audit.js"></script></html>';
const sessions = new Map(), marks = new Map(), closes = new Map();
let ambiguousResponse = true;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (body, type = "application/json", status = 200) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (url.pathname === "/moncahier-sw.js") return send(read("public/moncahier-sw.js"), "application/javascript");
  if (url.pathname === "/_next/static/audit.js") return send(bundle, "application/javascript");
  if (url.pathname === "/manifest.webmanifest") return send({ name: "Audit isolé", start_url: "/class", display: "standalone" });
  if (url.pathname.startsWith("/icons/")) { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=", "base64")); }
  if (url.pathname === "/api/class/subjects") return send({ class_id: "synthetic-class", items: [{ id: "info", label: "Informatique" }, { id: "eps", label: "EPS" }] });
  if (url.pathname.startsWith("/api/")) {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const operation = String(req.headers["x-mon-cahier-operation-id"] || "");
    if (url.pathname === "/api/class/sessions/start") {
      if (!sessions.has(operation)) sessions.set(operation, { id: "synthetic-cloud-session", ...body });
      if (ambiguousResponse) { ambiguousResponse = false; return res.destroy(); }
      return send({ item: { id: sessions.get(operation).id, operation_id: operation } });
    }
    if (url.pathname === "/api/teacher/attendance/bulk") {
      assert.equal(body.session_id, "synthetic-cloud-session");
      marks.set(operation, body);
      return send({ ok: true, session_id: body.session_id, operation_id: operation });
    }
    if (url.pathname === "/api/class/sessions/end") {
      assert.equal(body.session_id, "synthetic-cloud-session");
      assert.equal(marks.size, 1);
      closes.set(operation, body);
      return send({ item: { id: body.session_id, operation_id: operation } });
    }
    return send({ error: "unexpected_fixture_api" }, "application/json", 404);
  }
  return send(html, "text/html");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mon-cahier-pwa-audit-"));
const executablePath = process.env.MON_CAHIER_AUDIT_BROWSER;
const options = { headless: true, ...(executablePath ? { executablePath } : {}) };
let context;
let stage = "launch";
async function step(name, work) {
  stage = name;
  console.log(`PWA browser: ${name}`);
  let timer;
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`PWA browser timeout: ${name}`)), 45_000);
    })]);
  } finally { clearTimeout(timer); }
}
try {
  context = await step("launch", () => chromium.launchPersistentContext(profile, options));
  let page = await context.newPage();
  await page.goto(`${origin}/class`);
  await page.waitForFunction(() => Boolean(window.audit));
  await step("register worker", () => page.evaluate(async () => {
    await navigator.serviceWorker.register("/moncahier-sw.js");
    await navigator.serviceWorker.ready;
  }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.audit) && Boolean(navigator.serviceWorker.controller));
  await step("prepare shell and subjects", () => page.evaluate(async () => {
    await window.audit.warmOfflineShell(["/class"]);
    const subjects = await window.audit.offlineGetJson("/api/class/subjects?class_id=synthetic-class&manual_course=1", "classDevice:manual-subjects:synthetic-class");
    if (subjects.items.length !== 2) throw new Error("manual_subjects_intercepted");
    await window.audit.cacheSet("classDevice:roster:synthetic-class", { items: [{ id: "pupil-a" }, { id: "pupil-b" }] });
  }));
  await context.setOffline(true);
  const captured = new Date().toISOString();
  await page.evaluate(async (captured) => {
    const api = window.audit, reference = "client:synthetic-start-001";
    const queue = (url, operationId, type, body) => api.offlineMutateJson(url, {
      method: type === "session-end" ? "PATCH" : "POST", body,
    }, { operationId, queueOnly: true, meta: { operationType: type, clientSessionId: reference } });
    await queue("/api/class/sessions/start", "synthetic-start-001", "session-start", {
      class_id: "synthetic-class", subject_id: "info", manual_course: true,
      actual_call_at: captured, expected_minutes: 40, client_session_id: reference,
    });
    await queue("/api/teacher/attendance/bulk", "synthetic-marks-001", "attendance", {
      session_id: reference, marks: [{ student_id: "pupil-a", status: "absent" }, { student_id: "pupil-b", status: "late", observed_at: captured }],
    });
    await queue("/api/class/sessions/end", "synthetic-close-001", "session-end", { session_id: reference, actual_end_at: captured });
    if ((await api.outboxStats()).total !== 3) throw new Error("offline_queue_incomplete");
  }, captured);
  await step("close browser offline", () => context.close());
  context = await step("restart browser offline", () => chromium.launchPersistentContext(profile, { ...options, offline: true }));
  await context.setOffline(true);
  page = await context.newPage();
  await page.goto(`${origin}/class`);
  await page.waitForFunction(() => Boolean(window.audit));
  const restored = await page.evaluate(async () => ({
    count: (await window.audit.outboxStats()).total,
    pupils: (await window.audit.cacheGet("classDevice:roster:synthetic-class")).items.length,
    subjects: (await window.audit.offlineGetJson("/api/class/subjects?class_id=synthetic-class&manual_course=1", "classDevice:manual-subjects:synthetic-class")).items.length,
  }));
  assert.deepEqual(restored, { count: 3, pupils: 2, subjects: 2 });
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine);
  // A lost response can be reported as HTTP failure by the worker. Respect
  // the real retry delay instead of running all attempts in the same tick.
  for (let attempt = 0; attempt < 30; attempt++) {
    const replay = await page.evaluate(() => window.audit.flushOutbox({ releaseNetworkBackoff: true }));
    console.log(`PWA replay ${attempt + 1}: ${JSON.stringify(replay)}`);
    if (await page.evaluate(async () => (await window.audit.outboxStats()).total === 0)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(await page.evaluate(async () => (await window.audit.outboxStats()).total), 0);
  assert.equal(sessions.size, 1); assert.equal(marks.size, 1); assert.equal(closes.size, 1);
  assert.equal([...sessions.values()][0].actual_call_at, captured);
  assert.deepEqual([...marks.values()][0].marks.map((mark) => mark.status), ["absent", "late"]);
  assert.equal([...closes.values()][0].actual_end_at, captured);
  console.log(JSON.stringify({ validated: true, realServiceWorker: true, realIndexedDB: true, browserRestartOffline: true,
    lostStartResponse: true, cloudSessions: sessions.size, attendanceReceipts: marks.size, closeReceipts: closes.size,
    origin, browser: await context.browser()?.version() }));
} finally {
  console.log(`PWA browser: cleanup after ${stage}`);
  await context?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
