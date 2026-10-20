import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";
import ts from "typescript";

const browser = new Window({ url: "https://school.invalid/admin/import-emplois-du-temps" });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? browser : browser[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const loaded = new Map();
function load(path) {
  if (loaded.has(path)) return loaded.get(path);
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    if (id === "@/components/admin/EducationScopeFilter") return { __esModule: true, default: ({ value, onChange }) =>
      React.createElement("select", { "aria-label": "Classe précise", value: value.classId,
        onChange: (event) => onChange({ ...value, classId: event.target.value }) },
      ...[["", "Toutes les classes"], ["1a", "1A"], ["2a", "2A"]].map(([value, label]) =>
        React.createElement("option", { key: value, value }, label))) };
    if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`);
    return require(id);
  }, module, module.exports);
  loaded.set(path, module.exports);
  return module.exports;
}
const Page = load("src/app/admin/import-emplois-du-temps/page.tsx").default;
const subjects = [{ id: "math", label: "MATHÉMATIQUES ET APPLICATIONS" }, { id: "pc", label: "PHYSIQUE-CHIMIE" }];
const teachers = [{ id: "brou", display_name: "M. BROU BONI ARMEL", phone: null }, { id: "hans", display_name: "PÈRE HANS ADJOBI", phone: null }];
const classes = [{ id: "1a", label: "1A" }, { id: "2a", label: "2A" }];
const originalRows = [
  { weekday: 1, period_id: "p1", class_id: "1a", class_label: "1A", subject_id: "math", teacher_id: "brou" },
  { weekday: 1, period_id: "p1", class_id: "1a", class_label: "1A", subject_id: "pc", teacher_id: "hans" },
  { weekday: 1, period_id: "p1", class_id: "2a", class_label: "2A", subject_id: "math", teacher_id: "brou" },
];
const periods = [1, 2].map((number) => ({ id: `p${number}`, weekday: 1, period_no: number,
  start_time: number === 1 ? "10:15:00" : "11:10:00", end_time: number === 1 ? "11:10:00" : "12:05:00" }));

async function mount(intercept) {
  let rows = structuredClone(originalRows);
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    const parsed = new URL(url, "https://school.invalid");
    const classId = parsed.searchParams.get("class_id");
    const scopedRows = rows.filter((row) => !classId || row.class_id === classId);
    const overridden = intercept?.(parsed, options);
    if (overridden) return overridden;
    if (parsed.pathname.endsWith("/meta")) return Response.json({
      allClasses: classes, classes: classes.filter((row) => !classId || row.id === classId), subjects, teachers, periods, occupancy: scopedRows,
    });
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      rows = rows.filter((row) => !(row.subject_id === body.subject_id && row.teacher_id === body.teacher_id &&
        (!body.class_id || row.class_id === body.class_id)));
      rows.push(...body.items.flatMap((item) => item.class_ids.map((class_id) => ({ ...item, class_id,
        class_label: classes.find((row) => row.id === class_id).label, subject_id: body.subject_id, teacher_id: body.teacher_id }))));
      return Response.json({ ok: true });
    }
    const subjectId = parsed.searchParams.get("subject_id"), teacherId = parsed.searchParams.get("teacher_id");
    return Response.json({ subject_id: subjectId, teachers,
      teacherClasses: classes.filter((row) => !classId || row.id === classId).map((row) => ({ teacher_id: teacherId,
        class_id: row.id, class_label: row.label })),
      existing: scopedRows.filter((row) => row.subject_id === subjectId && row.teacher_id === teacherId),
      occupancy: scopedRows, teacherOccupancy: rows.filter((row) => row.teacher_id === teacherId) });
  };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Page)));
  await click(button(host, "Saisie manuelle"));
  return { host, requests, get rows() { return rows; }, async close() {
    await act(async () => root.unmount()); host.remove();
  } };
}
const button = (host, label) => [...host.querySelectorAll("button")].find((item) => item.textContent.includes(label));
const cell = (host, time) => [...host.querySelectorAll("table button")].find((item) => item.textContent.includes(time));
const courseButton = (host, subject) => [...host.querySelectorAll("li")].find((item) => item.textContent.includes(subject))?.querySelector("button");
async function click(element) { assert.ok(element); await act(async () => element.click()); }
async function chooseClass(host, value) { await act(async () => {
  const select = host.querySelector('[aria-label="Classe précise"]');
  select.value = value; select.dispatchEvent(new browser.Event("change", { bubbles: true }));
}); }

test("la grille montre tous les cours et leurs noms complets avant tout choix de professeur", async () => {
  const view = await mount();
  try {
    const occupied = cell(view.host, "10:15");
    assert.equal(occupied.disabled, false);
    for (const label of [...subjects.map((row) => row.label), ...teachers.map((row) => row.display_name), "1A", "2A"]) {
      assert.ok(occupied.textContent.includes(label), label);
    }
    assert.doesNotMatch(occupied.textContent, /cours occupé/);
    await chooseClass(view.host, "1a");
    assert.ok(!cell(view.host, "10:15").textContent.includes("2A"));
    await click(cell(view.host, "10:15"));
    assert.equal(view.host.querySelectorAll("h3").length, 2, "détails présents sur ordinateur et mobile");
    assert.equal(button(view.host, "Enregistrer pour ce professeur").disabled, true);
    assert.equal(view.requests.filter((row) => row.method === "POST").length, 0);
  } finally { await view.close(); }
});

test("modifier et déplacer un cours conserve les autres cours et les autres classes", async () => {
  const view = await mount();
  try {
    await chooseClass(view.host, "1a");
    await click(cell(view.host, "10:15"));
    await click(courseButton(view.host, subjects[0].label));
    assert.ok(cell(view.host, "10:15").textContent.includes(teachers[1].display_name), "l'autre professeur reste visible");
    assert.equal(button(view.host, "Enregistrer pour ce professeur").disabled, false);
    const checkbox = view.host.querySelector('input[type="checkbox"]');
    assert.equal(checkbox.checked, true, "le cours existant est précoché");
    await click(checkbox);
    assert.equal(courseButton(view.host, subjects[1].label).disabled, true, "le changement de cours protège les modifications non enregistrées");
    await click(cell(view.host, "11:10–12:05"));
    await click(view.host.querySelector('input[type="checkbox"]'));
    assert.equal(view.requests.filter((row) => row.method === "POST").length, 0, "la consultation et le brouillon n'écrivent rien");
    await click(button(view.host, "Enregistrer pour ce professeur"));
    const writes = view.requests.filter((row) => row.method === "POST");
    assert.equal(writes.length, 1);
    const payload = JSON.parse(writes[0].body);
    assert.equal(payload.class_id, "1a");
    assert.equal(payload.subject_id, "math"); assert.equal(payload.teacher_id, "brou");
    assert.deepEqual(payload.items, [{ weekday: 1, period_id: "p2", class_ids: ["1a"] }]);
    assert.deepEqual(payload.clear_slots, [{ weekday: 1, period_id: "p1", class_id: "1a" }]);
    assert.ok(view.rows.some((row) => row.class_id === "2a" && row.period_id === "p1" && row.subject_id === "math"));
    assert.ok(view.rows.some((row) => row.class_id === "1a" && row.period_id === "p1" && row.subject_id === "pc"));
    assert.ok(!cell(view.host, "10:15").textContent.includes(subjects[0].label));
    assert.ok(cell(view.host, "11:10–12:05").textContent.includes(subjects[0].label));
  } finally { await view.close(); }
});

test("une réponse tardive d'une ancienne classe ne réactive pas l'éditeur ni l'enregistrement", async () => {
  let resolve;
  const pending = new Promise((yes) => { resolve = yes; });
  const view = await mount((url) => url.pathname.endsWith("/manual") ? pending : null);
  try {
    await chooseClass(view.host, "1a"); await click(cell(view.host, "10:15"));
    await click(courseButton(view.host, subjects[0].label));
    assert.equal(button(view.host, "Enregistrer pour ce professeur").disabled, true, "attente des données avant toute écriture");
    await chooseClass(view.host, "2a");
    await act(async () => resolve(Response.json({ subject_id: "math", teachers,
      teacherClasses: [{ teacher_id: "brou", class_id: "1a", class_label: "1A" }], existing: originalRows.slice(0, 1), occupancy: originalRows })));
    assert.equal(button(view.host, "Enregistrer pour ce professeur").disabled, true);
    assert.ok(!cell(view.host, "10:15").textContent.includes("1A"));
    assert.equal(view.requests.filter((row) => row.method === "POST").length, 0);
  } finally { await view.close(); }
});

test("une erreur de chargement conserve les cours visibles et interdit une sauvegarde vide", async () => {
  const view = await mount((url) => url.pathname.endsWith("/manual") ? Response.json({ message: "Chargement indisponible" }, { status: 503 }) : null);
  try {
    await click(cell(view.host, "10:15")); await click(courseButton(view.host, subjects[0].label));
    assert.ok(view.host.textContent.includes("Chargement indisponible"));
    assert.equal(button(view.host, "Enregistrer pour ce professeur").disabled, true);
    assert.ok(cell(view.host, "10:15").textContent.includes(subjects[0].label));
    assert.equal(view.requests.filter((row) => row.method === "POST").length, 0);
  } finally { await view.close(); }
});
