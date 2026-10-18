import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const cm1 = "11111111-1111-4111-8111-111111111111";
const cp1 = "22222222-2222-4222-8222-222222222222";
const arabic = "33333333-3333-4333-8333-333333333333";
const names = [
  "Lecture", "Écriture / Copie", "Orthographe / Dictée",
  "Expression écrite", "Exploitation de texte", "Éveil au milieu",
  "Mathématiques", "Chant / Poème", "Dessin", "EDHC", "EPS",
];
const subjects = names.map((name, i) => ({
  id: "44444444-4444-4444-8444-" + String(i + 1).padStart(12, "0"), name,
}));
const arabicSubject = { id: "55555555-5555-4555-8555-555555555555", name: "Coran" };
const all = [...subjects, arabicSubject];
const classes = [
  { id: cm1, label: "CM1 — Français", level: "CM1", cycle: "primary", track: "french" },
  { id: cp1, label: "CP1 — Français", level: "CP1", cycle: "primary", track: "french" },
  { id: arabic, label: "CM1 — Arabe", level: "CM1", cycle: "primary", track: "arabic" },
];
const json = data => new Response(JSON.stringify(data), { status: 200 });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function changeValue(node, value) {
  assert.ok(node);
  await act(async () => {
    // React 19 may not expose its internal props on all select elements.
    // Prefer the controlled handler when available, otherwise dispatch
    // a browser event as done by the existing multicycle UI suite.
    const key = Object.keys(node).find(k => k.startsWith("__reactProps$"));
    const onChange = key && node[key]?.onChange;
    if (typeof onChange === "function") onChange({ target: { value } });
    else {
      node.value = value;
      node.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
  });
}
function valueFor(container, name) {
  const row = [...container.querySelectorAll("tbody tr")].find(row => row.textContent.includes(name));
  assert.ok(row, "discipline not rendered: " + name);
  return row.querySelector('[aria-label^="Barème de composition "]')?.textContent.trim();
}

test("EPC : barèmes CM1 /20 et /50 affichés à la bonne matière, CP1 /10, sans écriture serveur", async () => {
  const win = new Window({ url: "https://fixture.invalid" });
  const originals = new Map(["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const changes = [];
  const configuration = {
    enabledCycles: ["primary"], teachingTracksByCycle: { primary: ["french", "arabic"] },
    subjectTracksByCycle: { primary: Object.fromEntries(all.map(subject => [
      subject.id, subject.id === arabicSubject.id ? ["arabic"] : ["french"],
    ])) },
  };
  const reporting = {
    version: 1, enabled: true, engine: "specialized", format: "separate",
    scales: [
      { cycle: "primary", track: "french", level: "CM1", maxScore: 10 },
      { cycle: "primary", track: "french", level: "CP1", maxScore: 10 },
      { cycle: "primary", track: "arabic", level: "CM1", maxScore: 20 },
    ], coefficients: [],
  };
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (uri, init = {}) => {
      const url = String(uri);
      if (init.method && init.method !== "GET") changes.push(url);
      if (url === "/api/admin/bulletin-templates") return json({
        ok: true, configuration, reporting, subjects: all, revision: "rev1",
      });
      if (url === "/api/admin/school-class-subjects") return json({ ok: true, classes });
      if (url.startsWith("/api/admin/school-class-subjects?")) {
        const id = new URL(url, "https://fixture.invalid").searchParams.get("class_id");
        return json({ ok: true, selectedClassId: id,
          selectedSubjectIds: id === arabic ? [arabicSubject.id] : subjects.map(s => s.id),
          ciPrimaryFrenchApplied: id !== arabic });
      }
      if (url === "/api/admin/institution/subject-coeffs") return json({ ok: true, items: [] });
      throw Error("unexpected request: " + url);
    },
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const target = win.document.createElement("div");
  win.document.body.append(target);
  const root = createRoot(target);
  try {
    const Component = createFixtureRouteLoader(createMulticycleFixture(), "test-user")(
      "src/components/admin/SchoolCoefficientsClassicWorkflow.tsx").default;
    await act(async () => root.render(React.createElement(Component)));
    await flush(); await flush();
    assert.equal(valueFor(target, "Orthographe / Dictée"), "/20");
    for (const name of ["Mathématiques", "Éveil au milieu", "Exploitation de texte"])
      assert.equal(valueFor(target, name), "/50", name);
    for (const name of ["Lecture", "Dessin", "EDHC", "EPS"])
      assert.equal(valueFor(target, name), "/10", name);
    assert.equal(target.querySelectorAll("tbody tr").length, 11);
    assert.equal(target.querySelectorAll('input[aria-label^="Coefficient "]').length, 0);
    assert.equal(target.querySelectorAll('input[aria-label^="Barème de composition "]').length, 0);

    await changeValue(target.querySelector('select[aria-label="Niveau et classe"]'), cp1);
    await flush(); await flush();
    for (const name of names) assert.equal(valueFor(target, name), "/10", name);

    await changeValue(target.querySelector('select[aria-label="Enseignement"]'), "arabic");
    await flush(); await flush();
    assert.equal(target.querySelector('input[aria-label="Barème de composition Coran"]')?.getAttribute("placeholder"), "Non défini");
    assert.equal(target.textContent.includes("Barème de composition"), true);
    assert.equal(changes.length, 0);
  } finally {
    await act(async () => root.unmount());
    await win.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
