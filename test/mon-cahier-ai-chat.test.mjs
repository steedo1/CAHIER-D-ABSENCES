import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";
import ts from "typescript";

const browser = new Window({ url: "https://school.invalid/admin" });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? browser : browser[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const loaded = new Map();
function load(path) {
  if (loaded.has(path)) return loaded.get(path);
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`);
    return require(id);
  }, module, module.exports);
  loaded.set(path, module.exports);
  return module.exports;
}

const Chat = load("src/components/admin/MonCahierAiChatBubble.tsx").default;
const context = { ok: true, conversation_context: "context-school-a", current_academic_year: {
  code: "2026-2027", label: "2026–2027", is_current: true,
  start_date: "2026-09-01", end_date: "2027-07-31",
} };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function mount(respond = () => Response.json(context)) {
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return respond(url, options, requests.length);
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Chat))); });
  return { host, requests, close: async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  } };
}
const button = (host, label) => [...host.querySelectorAll("button")].find((item) => item.textContent.includes(label) || item.getAttribute("aria-label") === label);
async function click(element) {
  assert.ok(element, "button is rendered");
  await act(async () => { element.click(); });
}
async function change(element, value) {
  assert.ok(element);
  await act(async () => {
    const prototype = element.tagName === "TEXTAREA" ? browser.HTMLTextAreaElement.prototype : browser.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new browser.Event("input", { bubbles: true }));
    element.dispatchEvent(new browser.Event("change", { bubbles: true }));
  });
}

test("opening the actual chat finishes preparation and enables questions after a delayed response", async () => {
  const pending = deferred();
  const ui = await mount(() => pending.promise);
  try {
    assert.equal(ui.requests.length, 0, "closed chat does not consume API requests");
    await click(button(ui.host, "Ouvrir Cahier IA"));
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.host.querySelector("textarea").disabled, true);
    await act(async () => { pending.resolve(Response.json(context)); });
    assert.equal(ui.host.querySelector("textarea").disabled, false);
    assert.equal(button(ui.host, "Quels élèves doivent être suivis en priorité ?").disabled, false);
    assert.match(ui.host.textContent, /2026–2027/);
  } finally { await ui.close(); }
});

test("closing during preparation cancels it and reopening can prepare again without a reload", async () => {
  const old = deferred();
  const ui = await mount((_url, _options, attempt) => attempt === 1 ? old.promise : Response.json(context));
  try {
    await click(button(ui.host, "Ouvrir Cahier IA"));
    await click(button(ui.host, "Fermer Cahier IA"));
    assert.equal(ui.requests[0].options.signal.aborted, true);
    await click(button(ui.host, "Ouvrir Cahier IA"));
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.host.querySelector("textarea").disabled, false);
    await act(async () => { old.resolve(Response.json({ ok: true, current_academic_year: { code: "OLD" } })); });
    assert.match(ui.host.textContent, /2026–2027/);
    assert.doesNotMatch(ui.host.textContent, /OLD/);
    await click(button(ui.host, "Fermer Cahier IA"));
    await click(button(ui.host, "Ouvrir Cahier IA"));
    assert.equal(ui.requests.length, 2, "ready context is reused");
  } finally { await ui.close(); }
});

for (const firstResponse of [
  () => { throw new TypeError("Connexion interrompue"); },
  () => Response.json({ ok: true, academic_years: [] }),
  () => new Response("<html>Gateway error</html>", { status: 502 }),
]) test("a failed preparation has a usable retry without loops or raw HTML", async () => {
  const ui = await mount((_url, _options, attempt) => attempt === 1 ? firstResponse() : Response.json(context));
  try {
    await click(button(ui.host, "Ouvrir Cahier IA"));
    assert.ok(ui.host.querySelector('[role="alert"]'));
    assert.equal(ui.requests.length, 1);
    assert.doesNotMatch(ui.host.textContent, /<html>/);
    await click(button(ui.host, "Réessayer la préparation"));
    assert.equal(ui.host.querySelector("textarea").disabled, false);
    assert.equal(ui.host.querySelector('[role="alert"]'), null);
    assert.equal(ui.requests.length, 2);
  } finally { await ui.close(); }
});

test("a question sends the active year and chosen date once and renders every computed result", async () => {
  const pending = deferred();
  const ui = await mount((url) => url.endsWith("bootstrap") ? Response.json(context) : pending.promise);
  try {
    await click(button(ui.host, "Ouvrir Cahier IA"));
    await change(ui.host.querySelector('input[type="date"]'), "2026-11-10");
    await change(ui.host.querySelector("textarea"), "Prépare le conseil de la 3e3");
    await act(async () => {
      const send = button(ui.host, "Envoyer la question");
      send.click(); send.click();
    });
    const post = ui.requests.filter((request) => request.options.method === "POST");
    assert.equal(post.length, 1, "rapid taps must not duplicate the analysis");
    assert.deepEqual(JSON.parse(post[0].options.body), {
      question: "Prépare le conseil de la 3e3", academic_year: "2026-2027", exam_date: "2026-11-10",
      class_id: null, level: null, core_completion_percent: 60,
      history: [], history_scope: { academic_year: "2026-2027", exam_date: "2026-11-10", context_key: "context-school-a" },
    });
    assert.equal(ui.host.querySelector("textarea").disabled, true);
    await act(async () => { pending.resolve(Response.json({ ok: true, answer: {
      title: "Analyse test", summary: "Résultats disponibles",
      quick_stats: { scope_label: "3e3", cards: [{ key: "students", label: "Élèves inscrits", value: "35", details: "Inscriptions actives" }], breakdown: [{ label: "Troisième", value: "1", details: "classe" }] },
      council_note: "NOTE CONSEIL\nObserver les résultats réels.",
      remediation_plan: ["Consolider les fractions | 3e3 | Enseignant | Cette semaine | À faire"],
    }, context_meta: { data_quality: { status: "partial", summary: "Les notes restent incomplètes." } } })); });
    for (const text of ["Analyse test", "Élèves inscrits", "35", "Troisième", "NOTE CONSEIL", "Observer les résultats réels.", "Consolider les fractions", "Les notes restent incomplètes."]) assert.ok(ui.host.textContent.includes(text), text);
    assert.equal(ui.host.querySelector("textarea").disabled, false);
  } finally { await ui.close(); }
});

test("an interrupted answer preserves the question and allows sending it again", async () => {
  let analyses = 0;
  const ui = await mount((url) => {
    if (url.endsWith("bootstrap")) return Response.json(context);
    if (++analyses === 1) throw new TypeError("Connexion interrompue");
    return Response.json({ ok: true, answer: { title: "Reprise réussie", summary: "Analyse disponible" } });
  });
  try {
    await click(button(ui.host, "Ouvrir Cahier IA"));
    await change(ui.host.querySelector("textarea"), "Résume la 6e1");
    await click(button(ui.host, "Envoyer la question"));
    assert.equal(ui.host.querySelector("textarea").value, "Résume la 6e1");
    assert.equal(button(ui.host, "Envoyer la question").disabled, false);
    await click(button(ui.host, "Envoyer la question"));
    assert.match(ui.host.textContent, /Reprise réussie/);
    assert.equal(analyses, 2);
  } finally { await ui.close(); }
});

test("a follow-up sends completed conversation turns and displays sources; a new date or discussion resets history", async () => {
  const ui = await mount((url) => url.endsWith("bootstrap") ? Response.json(context) : Response.json({ ok: true, answer: {
    title: "Enseignants", summary: "Deux enseignants sont inscrits dans l’établissement.", sources: ["Annuaire des enseignants"],
  } }));
  try {
    await click(button(ui.host, "Ouvrir Cahier IA"));
    await change(ui.host.querySelector("textarea"), "Combien d’enseignants ?");
    await click(button(ui.host, "Envoyer la question"));
    assert.match(ui.host.querySelector('[aria-label="Sources consultées"]').textContent, /Annuaire/);
    await change(ui.host.querySelector("textarea"), "Et dans la 3e3 ?");
    await click(button(ui.host, "Envoyer la question"));
    let posts = ui.requests.filter((request) => request.options.method === "POST");
    assert.deepEqual(JSON.parse(posts[1].options.body).history, [
      { role: "user", content: "Combien d’enseignants ?" },
      { role: "assistant", content: "Deux enseignants sont inscrits dans l’établissement." },
    ]);
    await change(ui.host.querySelector('input[type="date"]'), "2026-11-11");
    await change(ui.host.querySelector("textarea"), "Quand finit le trimestre ?");
    await click(button(ui.host, "Envoyer la question"));
    posts = ui.requests.filter((request) => request.options.method === "POST");
    assert.deepEqual(JSON.parse(posts[2].options.body).history, []);
    assert.equal(JSON.parse(posts[2].options.body).history_scope.exam_date, "2026-11-11");
    await click(button(ui.host, "Nouvelle discussion"));
    await change(ui.host.querySelector("textarea"), "Bonjour");
    await click(button(ui.host, "Envoyer la question"));
    posts = ui.requests.filter((request) => request.options.method === "POST");
    assert.deepEqual(JSON.parse(posts[3].options.body).history, []);
  } finally { await ui.close(); }
});

const { fetchAiJson, referenceDateForAcademicYear } = load("src/lib/mon-cahier-ai/client.ts");
for (const stalledBody of [false, true]) test(stalledBody ? "a stalled JSON body is bounded" : "a stalled request is bounded", async () => {
  let signal;
  globalThis.fetch = (_url, options) => {
    signal = options.signal;
    return stalledBody ? Promise.resolve({ ok: true, json: () => new Promise(() => {}) }) : new Promise(() => {});
  };
  await assert.rejects(fetchAiJson("/test", { timeoutMs: 10, timeoutMessage: "Délai dépassé" }), /Délai dépassé/);
  assert.equal(signal.aborted, true);
});

test("the reference date targets the current academic period and stays inside an archived or future year", () => {
  assert.equal(referenceDateForAcademicYear(context.current_academic_year, "2026-10-16"), "2026-10-16");
  assert.equal(referenceDateForAcademicYear(context.current_academic_year, "2026-08-01"), "2026-09-01");
  assert.equal(referenceDateForAcademicYear(context.current_academic_year, "2028-01-01"), "2027-07-31");
  assert.equal(referenceDateForAcademicYear({}, "2026-10-16"), "2026-10-16");
});

test("a missing bulletin average stays unknown while an actual zero remains a zero", () => {
  const { cleanNumberOrNull } = load("src/lib/mon-cahier-ai/core.ts");
  for (const value of [null, undefined, "", "  ", false, [], {}, "bad", Infinity]) assert.equal(cleanNumberOrNull(value), null);
  for (const value of [0, "0"]) assert.equal(cleanNumberOrNull(value), 0);
  assert.equal(cleanNumberOrNull("12.456", 2), 12.46);
});

test("a class named in a question selects its own students, subjects and class instead of sibling classes", () => {
  const { selectContextByQuestion } = load("src/lib/mon-cahier-ai/core.ts");
  const classes = ["3e3", "3e30", "3e1"].map((label) => ({ class_id: label, class_label: label, class_level: "3e" }));
  const data = { classes, students: classes.map((item) => ({ ...item, student_id: `s-${item.class_id}` })), subjects: classes.map((item) => ({ ...item, subject_id: "maths" })) };
  for (const question of ["Analyse la 3e3", "Quels élèves suivre dans la 3e 3 ?"]) {
    const scope = selectContextByQuestion(data, question);
    assert.deepEqual(scope.classes.map((item) => item.class_id), ["3e3"]);
    assert.deepEqual(scope.students.map((item) => item.student_id), ["s-3e3"]);
    assert.equal(scope.subjects.length, 1);
  }
});

test.after(async () => { await browser.close(); });
