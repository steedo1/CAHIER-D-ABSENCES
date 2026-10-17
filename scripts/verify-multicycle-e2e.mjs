import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream, existsSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMulticycleFixture, startFixtureSupabase } from "../test/helpers/multicycle-fixture.mjs";

// Uses only synthetic identities and an in-memory loopback Supabase transport.
// Never loads a .env file, uses external Supabase or changes a database schema.
const root = process.cwd();
assert.ok(existsSync(path.join(root, "src/app/super/ui/Shell.tsx")), "Run from the repository root");
assert.equal(existsSync(path.join(root, ".env.local")), false, "Use a clean worktree without real credentials");
const output = path.resolve(process.env.MULTICYCLE_E2E_OUTPUT || "../verification/multicycle-e2e");
mkdirSync(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function until(check, description, timeout = 120000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await pause(250);
  }
  throw new Error(`Timeout: ${description}${last ? ` (${last.message})` : ""}`);
}
const fixture = createMulticycleFixture();
const preserved = structuredClone(fixture.tables.institutions);
const transport = await startFixtureSupabase(fixture, Number(process.env.MULTICYCLE_E2E_SUPABASE_PORT || 0));
assert.equal(new URL(transport.url).hostname, "127.0.0.1");
const appPort = await freePort(), debugPort = await freePort();
const appUrl = `http://127.0.0.1:${appPort}`;
const log = createWriteStream(path.join(output, "next.log"));
const environment = { ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: transport.url, SUPABASE_URL: transport.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "isolated-fixture-anon", SUPABASE_ANON_KEY: "isolated-fixture-anon",
  SUPABASE_SERVICE_ROLE_KEY: "isolated-fixture-service-role", DEFAULT_TEMP_PASSWORD: "FixtureOnly2026!",
  MON_CAHIER_OFFLINE_AUTH_SECRET: "isolated-fixture-offline-auth-only-2026",
  NEXT_TELEMETRY_DISABLED: "1",
};
const appMode = process.env.MULTICYCLE_E2E_APP_MODE === "production" ? "start" : "dev";
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", appMode, "--hostname", "127.0.0.1", "--port", String(appPort)], {
  cwd: root, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
app.stdout.pipe(log); app.stderr.pipe(log);
const browserPath = process.env.MULTICYCLE_BROWSER_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].find(existsSync);
assert.ok(browserPath, "Set MULTICYCLE_BROWSER_PATH to a Chromium browser");
const profile = mkdtempSync(path.join(os.tmpdir(), "multicycle-browser-"));
let browser, socket, currentPage = "", readBrowserState = async () => ({});
const evidence = [], exceptions = [];
try {
  await until(async () => (await fetch(`${appUrl}/login?space=direction`)).status === 200, "Next server startup", 240000);
  // Cold dev compilation can exceed the application's deliberately short login
  // timeout. Compile auth handlers using read-only requests before the UI story.
  await Promise.all(["/api/auth/login", "/api/auth/sync", "/api/auth/role"].map(route => fetch(appUrl + route)));
  browser = spawn(browserPath, ["--headless=new", "--guest", "--disable-sync", "--disable-background-networking", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, "about:blank"],
  { windowsHide: true, stdio: "ignore" });
  const target = await until(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.find(item => item.type === "page" && item.url === "about:blank");
  }, "headless browser startup");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0, navigations = 0; const pending = new Map();
  socket.addEventListener("message", event => {
    const data = JSON.parse(event.data);
    if (data.method === "Page.loadEventFired") navigations++;
    if (data.method === "Runtime.exceptionThrown") exceptions.push({ page: currentPage, text: data.params.exceptionDetails.text,
      description: data.params.exceptionDetails.exception?.description });
    const item = pending.get(data.id);
    if (item) {
      clearTimeout(item.timer); pending.delete(data.id);
      if (data.error) item.reject(new Error(data.error.message)); else item.resolve(data.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 60000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  readBrowserState = () => evaluate("({url:location.href,text:document.body.innerText.slice(-12000)})");
  const go = async route => { currentPage = route; const previous = navigations;
    writeFileSync(path.join(output, "progress.json"), JSON.stringify({ page: route, evidence }));
    await send("Page.navigate", { url: appUrl + route });
    await until(async () => navigations > previous && await evaluate("document.readyState === 'complete'"), `page ${route}`); };
  const visible = text => until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), text);
  const click = text => evaluate(`(() => { const node = [...document.querySelectorAll('button,a')].find(item => item.textContent.trim() === ${JSON.stringify(text)}); if (!node) throw Error('Control missing'); node.click(); return true; })()`);
  const fill = async (selector, value) => {
    await until(() => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); return !!node && Object.keys(node).some(key => key.startsWith('__reactProps')); })()`), `hydrated field ${selector}`);
    const kind = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (node.tagName === 'SELECT') { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(node, ${JSON.stringify(value)}); node.dispatchEvent(new Event('change', {bubbles:true})); return 'select'; } node.focus(); node.select(); return 'input'; })()`);
    if (kind === "input") await send("Input.insertText", { text: value });
  };
  const check = selector => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw Error('Checkbox missing'); node.click(); return node.checked; })()`);
  const screenshot = async name => { const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(path.join(output, name), Buffer.from(result.data, "base64")); };
  const viewport = (width, height, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await viewport(1440, 1000);
  await go("/login?space=direction");
  await until(() => evaluate("!!document.querySelector('input[type=email]')"), "login email form");
  await fill("input[type=email]", "super@example.invalid"); await fill("input[type=password]", "FixtureOnly2026!");
  assert.equal(await evaluate("document.querySelector('form button[type=submit]').disabled"), false, "Login fields must update React state before submission");
  await evaluate("document.querySelector('form button[type=submit]').click()");
  await until(() => evaluate("location.pathname.startsWith('/super/')"), "Super Admin login");
  await visible("Créer un abonnement");
  await click("Créer un abonnement"); await visible("Type d’établissement");
  assert.equal(await evaluate("!!document.querySelector('a[href=\"/super/cycles\"]')"), true);
  await fill("#school-name", "École franco-arabe de test isolé"); await fill("#school-code", "FA-TEST-20261017");
  await fill("#school-kind", "franco_arabic"); await pause(250);
  await check("#creation-cycle-preschool"); await pause(150); await check("#creation-cycle-primary"); await pause(150);
  assert.equal(await evaluate("document.querySelectorAll('[id^=creation-track-]:checked').length"), 6);
  await screenshot("creation-desktop.png"); await viewport(390, 844, true); await pause(300);
  assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Mobile creation form must not overflow");
  await screenshot("creation-mobile.png"); await viewport(1440, 1000);
  await click("Créer l’établissement");
  const created = await until(() => fixture.tables.institutions.find(row => row.code_unique === "FA-TEST-20261017"), "institution saved");
  await visible("Établissement créé.");
  assert.equal(created.settings_json.school_cycles_v1.enabledCycles.length, 3);
  for (const tracks of Object.values(created.settings_json.school_cycles_v1.teachingTracksByCycle)) assert.deepEqual(tracks, ["french", "arabic"]);
  evidence.push("Super Admin login → actual subscription page → three cycles and both teachings saved");
  await fill("input[type=email]", "school-admin@example.invalid"); await click("Ajouter l’admin");
  const admin = await until(() => [...fixture.users.values()].find(entry => entry.user.email === "school-admin@example.invalid"), "initial admin created");
  await until(() => fixture.tables.user_roles.some(row => row.profile_id === admin.user.id && row.institution_id === created.id && row.role === "admin"), "admin assigned to new school");
  await fill("#school-kind", "ordinary"); await pause(150);
  if (await evaluate("document.querySelector('#school-custom-cycles').checked")) await check("#school-custom-cycles");
  await fill("#school-name", "École ordinaire de test isolé"); await fill("#school-code", "ORD-TEST-20261017");
  await click("Créer l’établissement");
  const ordinary = await until(() => fixture.tables.institutions.find(row => row.code_unique === "ORD-TEST-20261017"), "ordinary institution saved");
  assert.equal("school_cycles_v1" in ordinary.settings_json, false);
  evidence.push("Ordinary school creation keeps the historical settings structure");
  await click("Liste des établissements"); await visible("FA-TEST-20261017"); await visible("ORD-TEST-20261017");
  await screenshot("institutions-list.png");
  await evaluate(`document.querySelector('a[href="/super/cycles?inst=${created.id}"]').click()`);
  await until(() => evaluate(`document.querySelector('#school-select')?.value === ${JSON.stringify(created.id)} && !!document.querySelector('#configuration-track-primary-french')`), "selected school cycle editor");
  await check("#configuration-track-primary-french"); await click("Enregistrer la configuration");
  await until(() => created.settings_json.school_cycles_v1.teachingTracksByCycle.primary.length === 1, "cycle teaching modification saved");
  await go(`/super/cycles?inst=${created.id}`);
  await until(() => evaluate("document.querySelector('#configuration-track-primary-french')?.checked === false"), "saved configuration restored after reload");
  await screenshot("cycles-editor.png");
  evidence.push("New school appears in the actual list; its cycle editor saves and restores modifications");
  // Authenticated school session through the application's real login API.
  await evaluate("localStorage.clear(); sessionStorage.clear()"); await send("Network.clearBrowserCookies");
  await go("/login?space=direction"); await until(() => evaluate("!!document.querySelector('input[type=email]')"), "admin login form");
  await fill("input[type=email]", "school-admin@example.invalid"); await fill("input[type=password]", "FixtureOnly2026!");
  await evaluate("document.querySelector('form button[type=submit]').click()");
  await until(() => evaluate("location.pathname.startsWith('/admin/')"), "school admin login");
  await go("/admin/bulletins/modeles"); await visible("Modèles et paramètres des bulletins");
  await visible("Matières proposées par votre établissement");
  const forbidden = await evaluate("fetch('/api/super/institutions', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Forbidden',code_unique:'NO'})}).then(response => response.status)");
  assert.equal(forbidden, 403);
  await screenshot("school-admin-models.png");
  await send("Emulation.setEmulatedMedia", { media: "print" });
  const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
  writeFileSync(path.join(output, "bulletin-combined.pdf"), Buffer.from(pdf.data, "base64"));
  await send("Emulation.setEmulatedMedia", { media: "screen" });
  evidence.push("New initial school admin logs in and reaches pedagogical templates; school admin cannot create institutions");
  assert.deepEqual(fixture.tables.institutions.filter(row => row.id === fixture.legacyId), preserved);
  assert.equal(fixture.tables.institutions.length, 3);
  assert.equal(fixture.calls.some(call => call.op !== "read" && ["students", "class_enrollments", "finance_payments"].includes(call.table)), false);
  const result = { ok: true, isolated: true, app: "actual Next.js application", transport: "in-memory loopback Supabase fixture",
    evidence, exceptions, institutionsCreated: 2, existingSchoolsUnchanged: true, screenshots: output };
  writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  assert.equal(exceptions.length, 0, "No uncaught browser exceptions expected");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  const browserState = await readBrowserState().catch(() => null);
  writeFileSync(path.join(output, "failure.json"), JSON.stringify({ message: error.message, page: currentPage, browserState, evidence, exceptions }, null, 2));
  throw error;
} finally {
  socket?.close(); browser?.kill(); app.kill(); transport.server.closeAllConnections();
  await new Promise(resolve => transport.server.close(resolve)); log.end();
}
